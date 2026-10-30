CREATE SCHEMA IF NOT EXISTS moriken_private;
REVOKE ALL ON SCHEMA moriken_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA moriken_private TO authenticated;
-- Align the DB rate limit with the existing UI and template rate limit.
ALTER TABLE public.match_sessions DROP CONSTRAINT match_sessions_rate_multiplier_check;
ALTER TABLE public.match_sessions ADD CONSTRAINT match_sessions_rate_multiplier_check CHECK (rate_multiplier>0 AND rate_multiplier<=10000);
CREATE OR REPLACE FUNCTION moriken_private.create_match_session_v70(p_group_id uuid, p_session_date date, p_game_mode text, p_rate_label text, p_rate_multiplier numeric, p_starting_points integer, p_chip_value numeric, p_default_uma jsonb, p_tobi_enabled boolean, p_member_ids jsonb, p_notes text, p_rules jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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

  if p_rate_multiplier <= 0 or p_rate_multiplier > 10000 then
    raise exception 'レート倍率は0より大きく10,000以下で入力してください。';
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
$function$;;
REVOKE ALL ON FUNCTION moriken_private.create_match_session_v70(uuid,date,text,text,numeric,integer,numeric,jsonb,boolean,jsonb,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION moriken_private.create_match_session_v70(uuid,date,text,text,numeric,integer,numeric,jsonb,boolean,jsonb,text,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.create_match_session_v70(p_group_id uuid, p_session_date date, p_game_mode text, p_rate_label text, p_rate_multiplier numeric, p_starting_points integer, p_chip_value numeric, p_default_uma jsonb, p_tobi_enabled boolean, p_member_ids jsonb, p_notes text, p_rules jsonb) RETURNS uuid
 LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $wrapper$
 SELECT moriken_private.create_match_session_v70(p_group_id,p_session_date,p_game_mode,p_rate_label,p_rate_multiplier,p_starting_points,p_chip_value,p_default_uma,p_tobi_enabled,p_member_ids,p_notes,p_rules);
 $wrapper$;
 REVOKE ALL ON FUNCTION public.create_match_session_v70(uuid,date,text,text,numeric,integer,numeric,jsonb,boolean,jsonb,text,jsonb) FROM PUBLIC, anon;
 GRANT EXECUTE ON FUNCTION public.create_match_session_v70(uuid,date,text,text,numeric,integer,numeric,jsonb,boolean,jsonb,text,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION moriken_private.create_match_setting_template_v70(p_group_id uuid, p_name text, p_game_mode text, p_rate_label text, p_rate_multiplier numeric, p_starting_points integer, p_uma jsonb, p_chip_unit numeric, p_tobi_enabled boolean, p_rules jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
$function$;;
REVOKE ALL ON FUNCTION moriken_private.create_match_setting_template_v70(uuid,text,text,text,numeric,integer,jsonb,numeric,boolean,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION moriken_private.create_match_setting_template_v70(uuid,text,text,text,numeric,integer,jsonb,numeric,boolean,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.create_match_setting_template_v70(p_group_id uuid, p_name text, p_game_mode text, p_rate_label text, p_rate_multiplier numeric, p_starting_points integer, p_uma jsonb, p_chip_unit numeric, p_tobi_enabled boolean, p_rules jsonb) RETURNS uuid
 LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $wrapper$
 SELECT moriken_private.create_match_setting_template_v70(p_group_id,p_name,p_game_mode,p_rate_label,p_rate_multiplier,p_starting_points,p_uma,p_chip_unit,p_tobi_enabled,p_rules);
 $wrapper$;
 REVOKE ALL ON FUNCTION public.create_match_setting_template_v70(uuid,text,text,text,numeric,integer,jsonb,numeric,boolean,jsonb) FROM PUBLIC, anon;
 GRANT EXECUTE ON FUNCTION public.create_match_setting_template_v70(uuid,text,text,text,numeric,integer,jsonb,numeric,boolean,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION moriken_private.update_match_setting_template_v70(p_template_id uuid, p_name text, p_game_mode text, p_rate_label text, p_rate_multiplier numeric, p_starting_points integer, p_uma jsonb, p_chip_unit numeric, p_tobi_enabled boolean, p_rules jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
$function$;;
REVOKE ALL ON FUNCTION moriken_private.update_match_setting_template_v70(uuid,text,text,text,numeric,integer,jsonb,numeric,boolean,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION moriken_private.update_match_setting_template_v70(uuid,text,text,text,numeric,integer,jsonb,numeric,boolean,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.update_match_setting_template_v70(p_template_id uuid, p_name text, p_game_mode text, p_rate_label text, p_rate_multiplier numeric, p_starting_points integer, p_uma jsonb, p_chip_unit numeric, p_tobi_enabled boolean, p_rules jsonb) RETURNS void
 LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $wrapper$
 SELECT moriken_private.update_match_setting_template_v70(p_template_id,p_name,p_game_mode,p_rate_label,p_rate_multiplier,p_starting_points,p_uma,p_chip_unit,p_tobi_enabled,p_rules);
 $wrapper$;
 REVOKE ALL ON FUNCTION public.update_match_setting_template_v70(uuid,text,text,text,numeric,integer,jsonb,numeric,boolean,jsonb) FROM PUBLIC, anon;
 GRANT EXECUTE ON FUNCTION public.update_match_setting_template_v70(uuid,text,text,text,numeric,integer,jsonb,numeric,boolean,jsonb) TO authenticated;
