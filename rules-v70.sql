-- New optional settings leave legacy sessions and results untouched.
ALTER TABLE public.match_sessions ADD COLUMN rule_settings jsonb;
ALTER TABLE public.match_setting_templates ADD COLUMN rule_settings jsonb;

CREATE FUNCTION public.validate_match_rules_v70(p_rules jsonb, p_count integer, p_start integer)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE r integer; o numeric; u jsonb; total numeric; v numeric;
BEGIN
 IF jsonb_typeof(p_rules) IS DISTINCT FROM 'object' OR p_count NOT IN (3,4) THEN RAISE EXCEPTION 'ルール設定が不正です。'; END IF;
 r := (p_rules->>'return_points')::integer;
 o := (p_rules->>'oka')::numeric;
 u := p_rules->'base_uma';
 IF r IS NULL OR r NOT BETWEEN 100 AND 1000000 OR r % 100 <> 0 OR p_start IS NULL OR p_start NOT BETWEEN 100 AND 1000000 OR p_start % 100 <> 0 THEN RAISE EXCEPTION '持ち点・返し点は100点単位で指定してください。'; END IF;
 IF o IS NULL OR abs(o)>10000 OR o<>round(o,1) THEN RAISE EXCEPTION 'オカは0.1単位で指定してください。'; END IF;
 IF p_rules->>'tie_policy' IS NULL OR p_rules->>'tie_policy' NOT IN ('split','seat','manual') THEN RAISE EXCEPTION '同点処理を選択してください。'; END IF;
 IF jsonb_typeof(p_rules->'chip_enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'チップ設定が不正です。'; END IF;
 IF jsonb_typeof(u) IS DISTINCT FROM 'array' OR jsonb_array_length(u)<>p_count THEN RAISE EXCEPTION '全順位のウマを指定してください。'; END IF;
 total := 0;
 FOR v IN SELECT value::numeric FROM jsonb_array_elements_text(u) LOOP
   IF v IS NULL OR abs(v)>10000 OR v<>round(v,1) THEN RAISE EXCEPTION 'ウマは0.1単位で指定してください。'; END IF;
   total := total+v;
 END LOOP;
 IF abs(total + o + (p_start-r)*p_count/1000.0)>0.00001 THEN RAISE EXCEPTION '持ち点・返し点・ウマ・オカの収支合計が0になっていません。'; END IF;
 RETURN jsonb_build_object('version',1,'return_points',r,'oka',o,'base_uma',u,'tie_policy',p_rules->>'tie_policy','chip_enabled',(p_rules->>'chip_enabled')::boolean,'seat_order',coalesce(p_rules->'seat_order','[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.validate_match_rules_v70(jsonb,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_match_rules_v70(jsonb,integer,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_match_session_v70(p_group_id uuid, p_session_date date, p_game_mode text, p_rate_label text, p_rate_multiplier numeric, p_starting_points integer, p_chip_value numeric, p_default_uma jsonb, p_tobi_enabled boolean, p_member_ids jsonb, p_notes text, p_rules jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session_id uuid;
  v_expected_count integer;
  v_member_count integer;
  v_distinct_member_count integer;
  v_rules jsonb;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です。';
  end if;

  if not public.is_group_member(p_group_id) then
    raise exception 'このグループにセッションを作成する権限がありません。';
  end if;

  if p_game_mode = 'sanma' then
    v_expected_count := 3;
  elsif p_game_mode in ('yonin_sanma', 'yonma') then
    v_expected_count := 4;
  else
    raise exception '対局形式が不正です。';
  end if;

  if nullif(trim(coalesce(p_rate_label, '')), '') is null then
    raise exception 'レート区分を入力してください。';
  end if;

  if p_rate_multiplier <= 0 or p_rate_multiplier > 100 then
    raise exception 'レート倍率は0より大きく100以下で入力してください。';
  end if;

  if p_starting_points <= 0 then
    raise exception '初期持ち点は1以上で入力してください。';
  end if;

  if p_chip_value < 0 then
    raise exception 'チップ単価は0以上で入力してください。';
  end if;

  if jsonb_typeof(p_default_uma) <> 'array'
     or jsonb_array_length(p_default_uma) <> v_expected_count then
    raise exception 'ウマの人数設定が一致していません。';
  end if;

  if jsonb_typeof(p_member_ids) <> 'array' then
    raise exception '参加者の形式が不正です。';
  end if;

  select
    count(*),
    count(distinct value::uuid)
  into
    v_member_count,
    v_distinct_member_count
  from jsonb_array_elements_text(p_member_ids);

  if v_member_count <> v_expected_count
     or v_distinct_member_count <> v_expected_count then
    raise exception '参加者を%人、重複なしで選択してください。', v_expected_count;
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(p_member_ids) as x(value)
    left join public.group_members gm
      on gm.id = x.value::uuid
      and gm.group_id = p_group_id
    where gm.id is null
  ) then
    raise exception 'グループ外のメンバーは参加者にできません。';
  end if;

  v_rules := public.validate_match_rules_v70(p_rules, v_expected_count, p_starting_points);
  IF v_rules->>'tie_policy' = 'seat' AND (
    jsonb_typeof(v_rules->'seat_order') IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_rules->'seat_order') <> v_expected_count
    OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(v_rules->'seat_order')) <> v_expected_count
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_rules->'seat_order') x WHERE NOT p_member_ids @> jsonb_build_array(x.value))
  ) THEN RAISE EXCEPTION '同点時の優先順を全員重複なく指定してください。'; END IF;
  SELECT jsonb_agg(value::numeric + CASE WHEN ordinality=1 THEN (v_rules->>'oka')::numeric ELSE 0 END ORDER BY ordinality)
  INTO p_default_uma FROM jsonb_array_elements_text(v_rules->'base_uma') WITH ORDINALITY;
  IF NOT (v_rules->>'chip_enabled')::boolean THEN p_chip_value := 0; END IF;
  insert into public.match_sessions (
    group_id,
    session_date,
    game_mode,
    rate_label,
    rate_multiplier,
    starting_points,
    chip_value,
    default_uma,
    tobi_enabled,
    notes,
    created_by,
    rule_settings
  )
  values (
    p_group_id,
    coalesce(p_session_date, current_date),
    p_game_mode,
    trim(p_rate_label),
    p_rate_multiplier,
    p_starting_points,
    p_chip_value,
    p_default_uma,
    coalesce(p_tobi_enabled, false),
    coalesce(p_notes, ''),
    auth.uid(),
    v_rules
  )
  returning id into v_session_id;

  insert into public.match_session_members (
    session_id,
    member_id
  )
  select
    v_session_id,
    value::uuid
  from jsonb_array_elements_text(p_member_ids);

  return v_session_id;
end;
$function$;
REVOKE ALL ON FUNCTION public.create_match_session_v70(uuid,date,text,text,numeric,integer,numeric,jsonb,boolean,jsonb,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_match_session_v70(uuid,date,text,text,numeric,integer,numeric,jsonb,boolean,jsonb,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_match_hanchan(p_session_id uuid, p_uma jsonb, p_results jsonb, p_tobi_transfers jsonb, p_notes text, p_yakuman_records jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session public.match_sessions%rowtype;
  v_hanchan_id uuid;
  v_sequence_no integer;
  v_expected_count integer;
  v_result_count integer;
  v_distinct_member_count integer;
  v_distinct_rank_count integer;
  v_result jsonb;
  v_member_id uuid;
  v_rank smallint;
  v_final_points integer;
  v_score_points numeric(10, 1);
  v_uma_points numeric(10, 1);
  v_tobi_points numeric(10, 1);
  v_total_points numeric(10, 1);
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です。';
  end if;

  select *
  into v_session
  from public.match_sessions
  where id = p_session_id
  for update;

  if v_session.id is null then
    raise exception 'セッションが見つかりません。';
  end if;

  if not public.is_group_member(v_session.group_id) then
    raise exception 'このセッションを編集する権限がありません。';
  end if;

  if v_session.status <> 'open' then
    raise exception '精算済みのセッションには半荘を追加できません。';
  end if;

  p_tobi_transfers := coalesce(p_tobi_transfers, '[]'::jsonb);
  p_yakuman_records := coalesce(p_yakuman_records, '[]'::jsonb);

  select count(*)
  into v_expected_count
  from public.match_session_members
  where session_id = p_session_id;

  if jsonb_typeof(p_uma) <> 'array'
     or jsonb_array_length(p_uma) <> v_expected_count then
    raise exception 'ウマの設定が参加人数と一致していません。';
  end if;

  if jsonb_typeof(p_results) <> 'array'
     or jsonb_array_length(p_results) <> v_expected_count then
    raise exception '半荘結果の人数が一致していません。';
  end if;

  select
    count(*),
    count(distinct member_id),
    count(distinct rank)
  into
    v_result_count,
    v_distinct_member_count,
    v_distinct_rank_count
  from jsonb_to_recordset(p_results) as r(
    member_id uuid,
    rank smallint,
    final_points integer
  );

  if v_result_count <> v_expected_count
     or v_distinct_member_count <> v_expected_count
     or v_distinct_rank_count <> v_expected_count then
    raise exception '参加者または順位が重複・不足しています。';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_results) as r(
      member_id uuid,
      rank smallint,
      final_points integer
    )
    left join public.match_session_members sm
      on sm.session_id = p_session_id
      and sm.member_id = r.member_id
    where sm.member_id is null
      or r.rank not between 1 and v_expected_count
      or r.final_points is null
  ) then
    raise exception '半荘結果の内容が不正です。';
  end if;

  if jsonb_typeof(p_tobi_transfers) <> 'array' then
    raise exception '飛ばし点の形式が不正です。';
  end if;

  if not v_session.tobi_enabled
     and jsonb_array_length(p_tobi_transfers) > 0 then
    raise exception 'このセッションでは飛ばし点が無効です。';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_tobi_transfers) as t(
      from_member_id uuid,
      to_member_id uuid,
      points numeric
    )
    left join public.match_session_members from_member
      on from_member.session_id = p_session_id
      and from_member.member_id = t.from_member_id
    left join public.match_session_members to_member
      on to_member.session_id = p_session_id
      and to_member.member_id = t.to_member_id
    where from_member.member_id is null
      or to_member.member_id is null
      or t.from_member_id = t.to_member_id
      or t.points is null
      or t.points <= 0
  ) then
    raise exception '飛ばし点の内容が不正です。';
  end if;

  if jsonb_typeof(p_yakuman_records) <> 'array' then
    raise exception '役満記録の形式が不正です。';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_yakuman_records) as y(
      winner_member_id uuid,
      yakuman_name text,
      win_type text,
      houjuu_member_id uuid
    )
    left join public.match_session_members winner_member
      on winner_member.session_id = p_session_id
      and winner_member.member_id = y.winner_member_id
    left join public.match_session_members houjuu_member
      on houjuu_member.session_id = p_session_id
      and houjuu_member.member_id = y.houjuu_member_id
    where winner_member.member_id is null
      or nullif(trim(y.yakuman_name), '') is null
      or char_length(trim(y.yakuman_name)) > 60
      or y.win_type not in ('tsumo', 'ron')
      or (
        y.win_type = 'tsumo'
        and y.houjuu_member_id is not null
      )
      or (
        y.win_type = 'ron'
        and (
          y.houjuu_member_id is null
          or houjuu_member.member_id is null
          or y.houjuu_member_id = y.winner_member_id
        )
      )
  ) then
    raise exception '役満記録の内容が不正です。';
  end if;

  select coalesce(max(sequence_no), 0) + 1
  into v_sequence_no
  from public.match_hanchans
  where session_id = p_session_id;

  insert into public.match_hanchans (
    session_id,
    sequence_no,
    uma,
    notes
  )
  values (
    p_session_id,
    v_sequence_no,
    p_uma,
    coalesce(p_notes, '')
  )
  returning id into v_hanchan_id;

  insert into public.match_tobi_transfers (
    hanchan_id,
    from_member_id,
    to_member_id,
    points
  )
  select
    v_hanchan_id,
    from_member_id,
    to_member_id,
    points
  from jsonb_to_recordset(p_tobi_transfers) as t(
    from_member_id uuid,
    to_member_id uuid,
    points numeric
  );

  for v_result in
    select value
    from jsonb_array_elements(p_results)
  loop
    v_member_id := (v_result ->> 'member_id')::uuid;
    v_rank := (v_result ->> 'rank')::smallint;
    v_final_points := (v_result ->> 'final_points')::integer;

    v_score_points := round(
      (v_final_points - coalesce((v_session.rule_settings->>'return_points')::integer, v_session.starting_points)) / 1000.0,
      1
    );

    v_uma_points := (p_uma ->> (v_rank - 1))::numeric;

    select coalesce(
      sum(
        case
          when t.to_member_id = v_member_id then t.points
          else 0
        end
        -
        case
          when t.from_member_id = v_member_id then t.points
          else 0
        end
      ),
      0
    )
    into v_tobi_points
    from jsonb_to_recordset(p_tobi_transfers) as t(
      from_member_id uuid,
      to_member_id uuid,
      points numeric
    );

    v_total_points := round(
      v_score_points + v_uma_points + v_tobi_points,
      1
    );

    insert into public.match_hanchan_results (
      hanchan_id,
      member_id,
      rank,
      final_points,
      score_points,
      uma_points,
      tobi_points,
      total_points
    )
    values (
      v_hanchan_id,
      v_member_id,
      v_rank,
      v_final_points,
      v_score_points,
      v_uma_points,
      v_tobi_points,
      v_total_points
    );
  end loop;

  insert into public.match_yakuman_records (
    hanchan_id,
    winner_member_id,
    yakuman_name,
    win_type,
    houjuu_member_id
  )
  select
    v_hanchan_id,
    winner_member_id,
    trim(yakuman_name),
    win_type,
    case
      when win_type = 'ron' then houjuu_member_id
      else null
    end
  from jsonb_to_recordset(p_yakuman_records) as y(
    winner_member_id uuid,
    yakuman_name text,
    win_type text,
    houjuu_member_id uuid
  );

  return v_hanchan_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_match_hanchan(p_hanchan_id uuid, p_uma jsonb, p_results jsonb, p_tobi_transfers jsonb, p_notes text, p_yakuman_records jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session public.match_sessions%rowtype;
  v_session_id uuid;
  v_expected_count integer;
  v_result_count integer;
  v_distinct_member_count integer;
  v_distinct_rank_count integer;
  v_total_points integer;
  v_result jsonb;
  v_member_id uuid;
  v_rank smallint;
  v_final_points integer;
  v_score_points numeric(10, 1);
  v_uma_points numeric(10, 1);
  v_tobi_points numeric(10, 1);
  v_total_pt numeric(10, 1);
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です。';
  end if;

  select
    h.session_id
  into
    v_session_id
  from public.match_hanchans h
  where h.id = p_hanchan_id
  for update;

  if v_session_id is null then
    raise exception '半荘記録が見つかりません。';
  end if;

  select *
  into v_session
  from public.match_sessions
  where id = v_session_id;

  if not public.is_group_member(v_session.group_id) then
    raise exception 'この半荘記録を編集する権限がありません。';
  end if;

  p_tobi_transfers := coalesce(p_tobi_transfers, '[]'::jsonb);
  p_yakuman_records := coalesce(p_yakuman_records, '[]'::jsonb);

  select count(*)
  into v_expected_count
  from public.match_session_members
  where session_id = v_session_id;

  if jsonb_typeof(p_uma) <> 'array'
     or jsonb_array_length(p_uma) <> v_expected_count then
    raise exception 'ウマの設定が参加人数と一致していません。';
  end if;

  if jsonb_typeof(p_results) <> 'array'
     or jsonb_array_length(p_results) <> v_expected_count then
    raise exception '半荘結果の人数が一致していません。';
  end if;

  select
    count(*),
    count(distinct member_id),
    count(distinct rank),
    sum(final_points)
  into
    v_result_count,
    v_distinct_member_count,
    v_distinct_rank_count,
    v_total_points
  from jsonb_to_recordset(p_results) as r(
    member_id uuid,
    rank smallint,
    final_points integer
  );

  if v_result_count <> v_expected_count
     or v_distinct_member_count <> v_expected_count
     or v_distinct_rank_count <> v_expected_count then
    raise exception '参加者または順位が重複・不足しています。';
  end if;

  if v_total_points <> v_session.starting_points * v_expected_count then
    raise exception '最終持ち点合計が開始時の総点数と一致していません。';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_results) as r(
      member_id uuid,
      rank smallint,
      final_points integer
    )
    left join public.match_session_members sm
      on sm.session_id = v_session_id
      and sm.member_id = r.member_id
    where sm.member_id is null
      or r.rank not between 1 and v_expected_count
      or r.final_points is null
  ) then
    raise exception '半荘結果の内容が不正です。';
  end if;

  if jsonb_typeof(p_tobi_transfers) <> 'array' then
    raise exception '飛ばし点の形式が不正です。';
  end if;

  if not v_session.tobi_enabled
     and jsonb_array_length(p_tobi_transfers) > 0 then
    raise exception 'このセッションでは飛ばし点が無効です。';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_tobi_transfers) as t(
      from_member_id uuid,
      to_member_id uuid,
      points numeric
    )
    left join public.match_session_members from_member
      on from_member.session_id = v_session_id
      and from_member.member_id = t.from_member_id
    left join public.match_session_members to_member
      on to_member.session_id = v_session_id
      and to_member.member_id = t.to_member_id
    where from_member.member_id is null
      or to_member.member_id is null
      or t.from_member_id = t.to_member_id
      or t.points is null
      or t.points <= 0
  ) then
    raise exception '飛ばし点の内容が不正です。';
  end if;

  if jsonb_typeof(p_yakuman_records) <> 'array' then
    raise exception '役満記録の形式が不正です。';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_yakuman_records) as y(
      winner_member_id uuid,
      yakuman_name text,
      win_type text,
      houjuu_member_id uuid
    )
    left join public.match_session_members winner_member
      on winner_member.session_id = v_session_id
      and winner_member.member_id = y.winner_member_id
    left join public.match_session_members houjuu_member
      on houjuu_member.session_id = v_session_id
      and houjuu_member.member_id = y.houjuu_member_id
    where winner_member.member_id is null
      or nullif(trim(y.yakuman_name), '') is null
      or char_length(trim(y.yakuman_name)) > 60
      or y.win_type not in ('tsumo', 'ron')
      or (
        y.win_type = 'tsumo'
        and y.houjuu_member_id is not null
      )
      or (
        y.win_type = 'ron'
        and (
          y.houjuu_member_id is null
          or houjuu_member.member_id is null
          or y.houjuu_member_id = y.winner_member_id
        )
      )
  ) then
    raise exception '役満記録の内容が不正です。';
  end if;

  -- 既存明細を消して、編集後の内容で作り直す
  delete from public.match_yakuman_records
  where hanchan_id = p_hanchan_id;

  delete from public.match_tobi_transfers
  where hanchan_id = p_hanchan_id;

  delete from public.match_hanchan_results
  where hanchan_id = p_hanchan_id;

  update public.match_hanchans
  set
    uma = p_uma,
    notes = coalesce(p_notes, '')
  where id = p_hanchan_id;

  insert into public.match_tobi_transfers (
    hanchan_id,
    from_member_id,
    to_member_id,
    points
  )
  select
    p_hanchan_id,
    from_member_id,
    to_member_id,
    points
  from jsonb_to_recordset(p_tobi_transfers) as t(
    from_member_id uuid,
    to_member_id uuid,
    points numeric
  );

  for v_result in
    select value
    from jsonb_array_elements(p_results)
  loop
    v_member_id := (v_result ->> 'member_id')::uuid;
    v_rank := (v_result ->> 'rank')::smallint;
    v_final_points := (v_result ->> 'final_points')::integer;

    v_score_points := round(
      (v_final_points - coalesce((v_session.rule_settings->>'return_points')::integer, v_session.starting_points)) / 1000.0,
      1
    );

    v_uma_points := (p_uma ->> (v_rank - 1))::numeric;

    select coalesce(
      sum(
        case
          when t.to_member_id = v_member_id then t.points
          else 0
        end
        -
        case
          when t.from_member_id = v_member_id then t.points
          else 0
        end
      ),
      0
    )
    into v_tobi_points
    from jsonb_to_recordset(p_tobi_transfers) as t(
      from_member_id uuid,
      to_member_id uuid,
      points numeric
    );

    v_total_pt := round(
      v_score_points + v_uma_points + v_tobi_points,
      1
    );

    insert into public.match_hanchan_results (
      hanchan_id,
      member_id,
      rank,
      final_points,
      score_points,
      uma_points,
      tobi_points,
      total_points
    )
    values (
      p_hanchan_id,
      v_member_id,
      v_rank,
      v_final_points,
      v_score_points,
      v_uma_points,
      v_tobi_points,
      v_total_pt
    );
  end loop;

  insert into public.match_yakuman_records (
    hanchan_id,
    winner_member_id,
    yakuman_name,
    win_type,
    houjuu_member_id
  )
  select
    p_hanchan_id,
    winner_member_id,
    trim(yakuman_name),
    win_type,
    case
      when win_type = 'ron' then houjuu_member_id
      else null
    end
  from jsonb_to_recordset(p_yakuman_records) as y(
    winner_member_id uuid,
    yakuman_name text,
    win_type text,
    houjuu_member_id uuid
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_match_setting_template_v70(p_group_id uuid, p_name text, p_game_mode text, p_rate_label text, p_rate_multiplier numeric, p_starting_points integer, p_uma jsonb, p_chip_unit numeric, p_tobi_enabled boolean, p_rules jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_template_id uuid;
  v_expected_count integer;
  v_name text;
  v_rate_label text;
  v_rules jsonb;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です。';
  end if;

  if not public.is_group_member(p_group_id) then
    raise exception 'このグループにテンプレートを追加する権限がありません。';
  end if;

  v_name := left(
    regexp_replace(trim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g'),
    60
  );

  v_rate_label := left(
    regexp_replace(trim(coalesce(p_rate_label, '')), '[[:space:]]+', ' ', 'g'),
    40
  );

  if v_name = '' then
    raise exception 'テンプレート名を入力してください。';
  end if;

  if p_game_mode not in ('sanma', 'sanma4', 'yonma') then
    raise exception 'ゲーム形式が不正です。';
  end if;

  v_expected_count := case
    when p_game_mode = 'sanma' then 3
    else 4
  end;

  if p_uma is null
     or jsonb_typeof(p_uma) <> 'array'
     or jsonb_array_length(p_uma) <> v_expected_count then
    raise exception 'ウマの人数設定がゲーム形式と一致していません。';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(p_uma) as x(value)
    where trim(value) = ''
       or value !~ '^-?[0-9]+(\.[0-9]+)?$'
  ) then
    raise exception 'ウマの値が不正です。';
  end if;

  if p_rate_multiplier is null
     or p_rate_multiplier <= 0
     or p_rate_multiplier > 10000 then
    raise exception 'レート倍率は0より大きく10,000以下で入力してください。';
  end if;

  if p_starting_points is null
     or p_starting_points <= 0
     or p_starting_points > 100000 then
    raise exception '初期持ち点が不正です。';
  end if;

  if coalesce(p_chip_unit, 0) < 0 then
    raise exception 'チップ単価は0以上で入力してください。';
  end if;

  v_rules := public.validate_match_rules_v70(p_rules, v_expected_count, p_starting_points);
  SELECT jsonb_agg(value::numeric + CASE WHEN ordinality=1 THEN (v_rules->>'oka')::numeric ELSE 0 END ORDER BY ordinality)
  INTO p_uma FROM jsonb_array_elements_text(v_rules->'base_uma') WITH ORDINALITY;
  IF NOT (v_rules->>'chip_enabled')::boolean THEN p_chip_unit := 0; END IF;
  insert into public.match_setting_templates (
    group_id,
    name,
    game_mode,
    rate_label,
    rate_multiplier,
    starting_points,
    uma,
    chip_unit,
    tobi_enabled,
    created_by,
    rule_settings
  )
  values (
    p_group_id,
    v_name,
    p_game_mode,
    coalesce(nullif(v_rate_label, ''), 'カスタム'),
    round(p_rate_multiplier, 2),
    p_starting_points,
    p_uma,
    round(coalesce(p_chip_unit, 0), 2),
    coalesce(p_tobi_enabled, false),
    auth.uid(),
    v_rules
  )
  returning id into v_template_id;

  return v_template_id;
end;
$function$;
REVOKE ALL ON FUNCTION public.create_match_setting_template_v70(uuid,text,text,text,numeric,integer,jsonb,numeric,boolean,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_match_setting_template_v70(uuid,text,text,text,numeric,integer,jsonb,numeric,boolean,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_match_setting_template_v70(p_template_id uuid, p_name text, p_game_mode text, p_rate_label text, p_rate_multiplier numeric, p_starting_points integer, p_uma jsonb, p_chip_unit numeric, p_tobi_enabled boolean, p_rules jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_template public.match_setting_templates%rowtype;
  v_expected_count integer;
  v_name text;
  v_rate_label text;
  v_rules jsonb;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です。';
  end if;

  select *
  into v_template
  from public.match_setting_templates
  where id = p_template_id
  for update;

  if v_template.id is null then
    raise exception 'テンプレートが見つかりません。';
  end if;

  if not public.is_group_member(v_template.group_id) then
    raise exception 'このテンプレートを編集する権限がありません。';
  end if;

  if v_template.created_by is distinct from auth.uid()
     and not exists (
       select 1
       from public.group_members
       where group_id = v_template.group_id
         and user_id = auth.uid()
         and role = 'admin'
     ) then
    raise exception '自分が作成したテンプレートのみ編集できます。';
  end if;

  v_name := left(
    regexp_replace(trim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g'),
    60
  );

  v_rate_label := left(
    regexp_replace(trim(coalesce(p_rate_label, '')), '[[:space:]]+', ' ', 'g'),
    40
  );

  if v_name = '' then
    raise exception 'テンプレート名を入力してください。';
  end if;

  if p_game_mode not in ('sanma', 'sanma4', 'yonma') then
    raise exception 'ゲーム形式が不正です。';
  end if;

  v_expected_count := case
    when p_game_mode = 'sanma' then 3
    else 4
  end;

  if p_uma is null
     or jsonb_typeof(p_uma) <> 'array'
     or jsonb_array_length(p_uma) <> v_expected_count then
    raise exception 'ウマの人数設定がゲーム形式と一致していません。';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(p_uma) as x(value)
    where trim(value) = ''
       or value !~ '^-?[0-9]+(\.[0-9]+)?$'
  ) then
    raise exception 'ウマの値が不正です。';
  end if;

  if p_rate_multiplier is null
     or p_rate_multiplier <= 0
     or p_rate_multiplier > 10000 then
    raise exception 'レート倍率は0より大きく10,000以下で入力してください。';
  end if;

  if p_starting_points is null
     or p_starting_points <= 0
     or p_starting_points > 100000 then
    raise exception '初期持ち点が不正です。';
  end if;

  if coalesce(p_chip_unit, 0) < 0 then
    raise exception 'チップ単価は0以上で入力してください。';
  end if;

  v_rules := public.validate_match_rules_v70(p_rules, v_expected_count, p_starting_points);
  SELECT jsonb_agg(value::numeric + CASE WHEN ordinality=1 THEN (v_rules->>'oka')::numeric ELSE 0 END ORDER BY ordinality)
  INTO p_uma FROM jsonb_array_elements_text(v_rules->'base_uma') WITH ORDINALITY;
  IF NOT (v_rules->>'chip_enabled')::boolean THEN p_chip_unit := 0; END IF;
  update public.match_setting_templates
  set
    name = v_name,
    game_mode = p_game_mode,
    rate_label = coalesce(nullif(v_rate_label, ''), 'カスタム'),
    rate_multiplier = round(p_rate_multiplier, 2),
    starting_points = p_starting_points,
    uma = p_uma,
    chip_unit = round(coalesce(p_chip_unit, 0), 2),
    tobi_enabled = coalesce(p_tobi_enabled, false),
    rule_settings = v_rules,
    updated_at = now()
  where id = p_template_id;
end;
$function$;
REVOKE ALL ON FUNCTION public.update_match_setting_template_v70(uuid,text,text,text,numeric,integer,jsonb,numeric,boolean,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_match_setting_template_v70(uuid,text,text,text,numeric,integer,jsonb,numeric,boolean,jsonb) TO authenticated;
