CREATE OR REPLACE FUNCTION public.restore_jakuroku_backup(p_target_group_id uuid, p_backup jsonb, p_member_map jsonb DEFAULT '{}'::jsonb, p_options jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_preview jsonb;
  v_source_group_id uuid;
  v_source_group_name text;
  v_backup_format text;
  v_exported_at timestamptz;
  v_restore_run_id uuid;
  v_new_session_count integer;
  v_new_hanchan_count integer;
  v_table_name text;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です。';
  end if;

  if jsonb_typeof(p_options) <> 'object' then
    raise exception '復元オプションの形式が不正です。';
  end if;

  v_preview := public.preview_jakuroku_backup(
    p_target_group_id,
    p_backup,
    p_member_map
  );

  if coalesce(
    (v_preview ->> 'unresolved_member_count')::integer,
    0
  ) > 0 then
    raise exception '対応付けできていない参加メンバーがいます。';
  end if;

  if coalesce(
    (v_preview ->> 'new_session_count')::integer,
    0
  ) = 0 then
    return jsonb_build_object(
      'restored_session_count', 0,
      'restored_hanchan_count', 0,
      'message', '新たに復元する日次記録はありません。'
    );
  end if;

  v_source_group_id := (
    p_backup #>> '{group,id}'
  )::uuid;

  v_source_group_name := coalesce(
    p_backup #>> '{group,name}',
    ''
  );

  v_backup_format := coalesce(
    p_backup ->> 'format',
    'jakuroku-backup-v1'
  );

  begin
    v_exported_at := nullif(
      p_backup ->> 'exported_at',
      ''
    )::timestamptz;
  exception
    when others then
      v_exported_at := null;
  end;

  perform pg_advisory_xact_lock(
    hashtext(
      p_target_group_id::text
      || ':'
      || v_source_group_id::text
    )::bigint
  );

  create temporary table _jr_source_sessions (
    source_session_id uuid primary key,
    session_date date not null,
    game_mode text not null,
    rate_label text not null,
    rate_multiplier numeric not null,
    starting_points integer not null,
    chip_value numeric not null,
    default_uma jsonb not null,
    tobi_enabled boolean not null,
    venue_fee_total numeric not null,
    notes text,
    status text not null,
    settled_at timestamptz,
    created_at timestamptz
  ) on commit drop;

  insert into _jr_source_sessions (
    source_session_id,
    session_date,
    game_mode,
    rate_label,
    rate_multiplier,
    starting_points,
    chip_value,
    default_uma,
    tobi_enabled,
    venue_fee_total,
    notes,
    status,
    settled_at,
    created_at
  )
  select
    id,
    session_date,
    game_mode,
    rate_label,
    rate_multiplier,
    starting_points,
    chip_value,
    default_uma,
    tobi_enabled,
    venue_fee_total,
    coalesce(notes, ''),
    status,
    settled_at,
    created_at
  from jsonb_to_recordset(
    p_backup #> '{tables,sessions}'
  ) as s(
    id uuid,
    session_date date,
    game_mode text,
    rate_label text,
    rate_multiplier numeric,
    starting_points integer,
    chip_value numeric,
    default_uma jsonb,
    tobi_enabled boolean,
    venue_fee_total numeric,
    notes text,
    status text,
    settled_at timestamptz,
    created_at timestamptz
  );

  create temporary table _jr_source_session_members (
    source_session_id uuid not null,
    source_member_id uuid not null,
    primary key (
      source_session_id,
      source_member_id
    )
  ) on commit drop;

  insert into _jr_source_session_members (
    source_session_id,
    source_member_id
  )
  select
    session_id,
    member_id
  from jsonb_to_recordset(
    p_backup #> '{tables,sessionMembers}'
  ) as sm(
    session_id uuid,
    member_id uuid
  );

  if exists (
    select 1
    from _jr_source_session_members sm
    left join _jr_source_sessions s
      on s.source_session_id = sm.source_session_id
    where s.source_session_id is null
  ) then
    raise exception '参加者情報に存在しない日次記録が含まれています。';
  end if;

  create temporary table _jr_member_map (
    source_member_id uuid primary key,
    target_member_id uuid not null
  ) on commit drop;

  insert into _jr_member_map (
    source_member_id,
    target_member_id
  )
  select
    source_members.source_member_id,
    target_members.id
  from (
    select distinct source_member_id
    from _jr_source_session_members
  ) source_members
  join public.group_members target_members
    on target_members.group_id = p_target_group_id
    and target_members.id::text = coalesce(
      p_member_map ->> source_members.source_member_id::text,
      source_members.source_member_id::text
    );

  if (
    select count(distinct source_member_id)
    from _jr_source_session_members
  ) <> (
    select count(*)
    from _jr_member_map
  ) then
    raise exception '参加メンバーの対応付けが完了していません。';
  end if;

  create temporary table _jr_session_map (
    source_session_id uuid primary key,
    restored_session_id uuid not null,
    should_restore boolean not null
  ) on commit drop;

  insert into _jr_session_map (
    source_session_id,
    restored_session_id,
    should_restore
  )
  select
    s.source_session_id,
    gen_random_uuid(),
    not exists (
      select 1
      from public.backup_restore_session_map prior
      where prior.target_group_id = p_target_group_id
        and prior.source_group_id = v_source_group_id
        and prior.source_session_id = s.source_session_id
    )
    and not (
      v_source_group_id = p_target_group_id
      and exists (
        select 1
        from public.match_sessions current_session
        where current_session.id = s.source_session_id
      )
    )
  from _jr_source_sessions s;

  select count(*)
  into v_new_session_count
  from _jr_session_map
  where should_restore;

  if v_new_session_count = 0 then
    return jsonb_build_object(
      'restored_session_count', 0,
      'restored_hanchan_count', 0,
      'message', '新たに復元する日次記録はありません。'
    );
  end if;

  create temporary table _jr_source_hanchans (
    source_hanchan_id uuid primary key,
    source_session_id uuid not null,
    sequence_no integer not null,
    uma jsonb not null,
    notes text,
    created_at timestamptz
  ) on commit drop;

  insert into _jr_source_hanchans (
    source_hanchan_id,
    source_session_id,
    sequence_no,
    uma,
    notes,
    created_at
  )
  select
    id,
    session_id,
    sequence_no,
    uma,
    coalesce(notes, ''),
    created_at
  from jsonb_to_recordset(
    p_backup #> '{tables,hanchans}'
  ) as h(
    id uuid,
    session_id uuid,
    sequence_no integer,
    uma jsonb,
    notes text,
    created_at timestamptz
  );

  if exists (
    select 1
    from _jr_source_hanchans h
    left join _jr_source_sessions s
      on s.source_session_id = h.source_session_id
    where s.source_session_id is null
  ) then
    raise exception '半荘情報に存在しない日次記録が含まれています。';
  end if;

  create temporary table _jr_hanchan_map (
    source_hanchan_id uuid primary key,
    restored_hanchan_id uuid not null,
    restored_session_id uuid not null,
    should_restore boolean not null
  ) on commit drop;

  insert into _jr_hanchan_map (
    source_hanchan_id,
    restored_hanchan_id,
    restored_session_id,
    should_restore
  )
  select
    h.source_hanchan_id,
    gen_random_uuid(),
    sm.restored_session_id,
    sm.should_restore
  from _jr_source_hanchans h
  join _jr_session_map sm
    on sm.source_session_id = h.source_session_id;

  select count(*)
  into v_new_hanchan_count
  from _jr_hanchan_map
  where should_restore;

  insert into public.backup_restore_runs (
    group_id,
    source_group_id,
    source_group_name,
    backup_format,
    exported_at,
    restore_options,
    restored_session_count,
    restored_hanchan_count,
    created_by
  )
  values (
    p_target_group_id,
    v_source_group_id,
    v_source_group_name,
    v_backup_format,
    v_exported_at,
    p_options,
    v_new_session_count,
    v_new_hanchan_count,
    auth.uid()
  )
  returning id into v_restore_run_id;

  insert into public.match_sessions (
    id,
    group_id,
    session_date,
    game_mode,
    rate_label,
    rate_multiplier,
    starting_points,
    chip_value,
    default_uma,
    tobi_enabled,
    venue_fee_total,
    notes,
    status,
    settled_at,
    created_at,
    created_by
  )
  select
    sm.restored_session_id,
    p_target_group_id,
    s.session_date,
    s.game_mode,
    s.rate_label,
    s.rate_multiplier,
    s.starting_points,
    s.chip_value,
    s.default_uma,
    s.tobi_enabled,
    s.venue_fee_total,
    s.notes,
    s.status,
    s.settled_at,
    coalesce(s.created_at, now()),
    auth.uid()
  from _jr_source_sessions s
  join _jr_session_map sm
    on sm.source_session_id = s.source_session_id
  where sm.should_restore;

  insert into public.match_session_members (
    session_id,
    member_id
  )
  select
    sm.restored_session_id,
    mm.target_member_id
  from _jr_source_session_members source_members
  join _jr_session_map sm
    on sm.source_session_id = source_members.source_session_id
  join _jr_member_map mm
    on mm.source_member_id = source_members.source_member_id
  where sm.should_restore;

  insert into public.match_hanchans (
    id,
    session_id,
    sequence_no,
    uma,
    notes,
    created_at
  )
  select
    hm.restored_hanchan_id,
    hm.restored_session_id,
    h.sequence_no,
    h.uma,
    h.notes,
    coalesce(h.created_at, now())
  from _jr_source_hanchans h
  join _jr_hanchan_map hm
    on hm.source_hanchan_id = h.source_hanchan_id
  where hm.should_restore;

  if exists (
    select 1
    from jsonb_to_recordset(
      p_backup #> '{tables,results}'
    ) as r(
      id uuid,
      hanchan_id uuid,
      member_id uuid,
      rank smallint,
      final_points integer,
      score_points numeric,
      uma_points numeric,
      tobi_points numeric,
      total_points numeric
    )
    left join _jr_hanchan_map hm
      on hm.source_hanchan_id = r.hanchan_id
    left join _jr_member_map mm
      on mm.source_member_id = r.member_id
    where hm.source_hanchan_id is null
      or mm.source_member_id is null
  ) then
    raise exception '半荘結果に不正な参加者または半荘が含まれています。';
  end if;

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
  select
    hm.restored_hanchan_id,
    mm.target_member_id,
    r.rank,
    r.final_points,
    r.score_points,
    r.uma_points,
    r.tobi_points,
    r.total_points
  from jsonb_to_recordset(
    p_backup #> '{tables,results}'
  ) as r(
    id uuid,
    hanchan_id uuid,
    member_id uuid,
    rank smallint,
    final_points integer,
    score_points numeric,
    uma_points numeric,
    tobi_points numeric,
    total_points numeric
  )
  join _jr_hanchan_map hm
    on hm.source_hanchan_id = r.hanchan_id
  join _jr_member_map mm
    on mm.source_member_id = r.member_id
  where hm.should_restore;

  if exists (
    select 1
    from jsonb_to_recordset(
      p_backup #> '{tables,tobiTransfers}'
    ) as t(
      id uuid,
      hanchan_id uuid,
      from_member_id uuid,
      to_member_id uuid,
      points numeric
    )
    left join _jr_hanchan_map hm
      on hm.source_hanchan_id = t.hanchan_id
    left join _jr_member_map from_member
      on from_member.source_member_id = t.from_member_id
    left join _jr_member_map to_member
      on to_member.source_member_id = t.to_member_id
    where hm.source_hanchan_id is null
      or from_member.source_member_id is null
      or to_member.source_member_id is null
  ) then
    raise exception '飛ばし点に不正な参加者または半荘が含まれています。';
  end if;

  insert into public.match_tobi_transfers (
    hanchan_id,
    from_member_id,
    to_member_id,
    points
  )
  select
    hm.restored_hanchan_id,
    from_member.target_member_id,
    to_member.target_member_id,
    t.points
  from jsonb_to_recordset(
    p_backup #> '{tables,tobiTransfers}'
  ) as t(
    id uuid,
    hanchan_id uuid,
    from_member_id uuid,
    to_member_id uuid,
    points numeric
  )
  join _jr_hanchan_map hm
    on hm.source_hanchan_id = t.hanchan_id
  join _jr_member_map from_member
    on from_member.source_member_id = t.from_member_id
  join _jr_member_map to_member
    on to_member.source_member_id = t.to_member_id
  where hm.should_restore;

  if exists (
    select 1
    from jsonb_to_recordset(
      p_backup #> '{tables,yakumans}'
    ) as y(
      id uuid,
      hanchan_id uuid,
      winner_member_id uuid,
      yakuman_name text,
      win_type text,
      houjuu_member_id uuid,
      created_at timestamptz
    )
    left join _jr_hanchan_map hm
      on hm.source_hanchan_id = y.hanchan_id
    left join _jr_member_map winner_member
      on winner_member.source_member_id = y.winner_member_id
    left join _jr_member_map houjuu_member
      on houjuu_member.source_member_id = y.houjuu_member_id
    where hm.source_hanchan_id is null
      or winner_member.source_member_id is null
      or (
        y.houjuu_member_id is not null
        and houjuu_member.source_member_id is null
      )
  ) then
    raise exception '役満記録に不正な参加者または半荘が含まれています。';
  end if;

  insert into public.match_yakuman_records (
    hanchan_id,
    winner_member_id,
    yakuman_name,
    win_type,
    houjuu_member_id,
    created_at
  )
  select
    hm.restored_hanchan_id,
    winner_member.target_member_id,
    y.yakuman_name,
    y.win_type,
    houjuu_member.target_member_id,
    coalesce(y.created_at, now())
  from jsonb_to_recordset(
    p_backup #> '{tables,yakumans}'
  ) as y(
    id uuid,
    hanchan_id uuid,
    winner_member_id uuid,
    yakuman_name text,
    win_type text,
    houjuu_member_id uuid,
    created_at timestamptz
  )
  join _jr_hanchan_map hm
    on hm.source_hanchan_id = y.hanchan_id
  join _jr_member_map winner_member
    on winner_member.source_member_id = y.winner_member_id
  left join _jr_member_map houjuu_member
    on houjuu_member.source_member_id = y.houjuu_member_id
  where hm.should_restore;

  if exists (
    select 1
    from jsonb_to_recordset(
      p_backup #> '{tables,chips}'
    ) as c(
      session_id uuid,
      member_id uuid,
      chip_count numeric,
      updated_at timestamptz
    )
    left join _jr_session_map sm
      on sm.source_session_id = c.session_id
    left join _jr_member_map mm
      on mm.source_member_id = c.member_id
    where sm.source_session_id is null
      or mm.source_member_id is null
  ) then
    raise exception 'チップ情報に不正な参加者または日次記録が含まれています。';
  end if;

  insert into public.match_session_chips (
    session_id,
    member_id,
    chip_count,
    updated_at
  )
  select
    sm.restored_session_id,
    mm.target_member_id,
    c.chip_count,
    coalesce(c.updated_at, now())
  from jsonb_to_recordset(
    p_backup #> '{tables,chips}'
  ) as c(
    session_id uuid,
    member_id uuid,
    chip_count numeric,
    updated_at timestamptz
  )
  join _jr_session_map sm
    on sm.source_session_id = c.session_id
  join _jr_member_map mm
    on mm.source_member_id = c.member_id
  where sm.should_restore;

  if exists (
    select 1
    from jsonb_to_recordset(
      p_backup #> '{tables,prepayments}'
    ) as p(
      session_id uuid,
      member_id uuid,
      paid_molly numeric,
      updated_at timestamptz
    )
    left join _jr_session_map sm
      on sm.source_session_id = p.session_id
    left join _jr_member_map mm
      on mm.source_member_id = p.member_id
    where sm.source_session_id is null
      or mm.source_member_id is null
  ) then
    raise exception '場代先払い情報に不正な参加者または日次記録が含まれています。';
  end if;

  insert into public.match_session_venue_prepayments (
    session_id,
    member_id,
    paid_molly,
    updated_at
  )
  select
    sm.restored_session_id,
    mm.target_member_id,
    p.paid_molly,
    coalesce(p.updated_at, now())
  from jsonb_to_recordset(
    p_backup #> '{tables,prepayments}'
  ) as p(
    session_id uuid,
    member_id uuid,
    paid_molly numeric,
    updated_at timestamptz
  )
  join _jr_session_map sm
    on sm.source_session_id = p.session_id
  join _jr_member_map mm
    on mm.source_member_id = p.member_id
  where sm.should_restore;

  insert into public.backup_restore_session_map (
    restore_run_id,
    target_group_id,
    source_group_id,
    source_session_id,
    restored_session_id
  )
  select
    v_restore_run_id,
    p_target_group_id,
    v_source_group_id,
    source_session_id,
    restored_session_id
  from _jr_session_map
  where should_restore;

  perform public.record_group_activity(
    p_target_group_id,
    'backup_restored',
    'group',
    p_target_group_id,
    format(
      'JSONバックアップから%s日分の記録を復元しました。',
      v_new_session_count
    ),
    jsonb_build_object(
      'restore_run_id', v_restore_run_id,
      'source_group_id', v_source_group_id,
      'source_group_name', v_source_group_name,
      'restored_session_count', v_new_session_count,
      'restored_hanchan_count', v_new_hanchan_count
    )
  );

  -- Carry the optional rule settings through the existing restore ID maps.
  update public.match_sessions target
  set rule_settings = public.validate_match_rules_v70(
    source.rule_settings || jsonb_build_object('seat_order', coalesce((
      select jsonb_agg(mm.target_member_id order by seat.ordinality)
      from jsonb_array_elements_text(coalesce(source.rule_settings->'seat_order','[]'::jsonb)) with ordinality seat
      join _jr_member_map mm on mm.source_member_id=seat.value::uuid
    ), '[]'::jsonb)),
    (select count(*)::integer from public.match_session_members where session_id=target.id),target.starting_points)
  from public.backup_restore_session_map map
  join jsonb_to_recordset(p_backup #> '{tables,sessions}') source(id uuid,rule_settings jsonb)
    on source.id=map.source_session_id
  where map.restore_run_id=v_restore_run_id and target.id=map.restored_session_id and source.rule_settings is not null;

  perform moriken_private.save_hanchan_input_v70(map.restored_hanchan_id,source.input_uma)
  from _jr_hanchan_map map
  join jsonb_to_recordset(p_backup #> '{tables,hanchans}') source(id uuid,input_uma jsonb)
    on source.id=map.source_hanchan_id
  where map.should_restore and source.input_uma is not null;

  return jsonb_build_object(
    'restore_run_id', v_restore_run_id,
    'restored_session_count', v_new_session_count,
    'restored_hanchan_count', v_new_hanchan_count,
    'message', format(
      '%s日分・%s半荘を復元しました。',
      v_new_session_count,
      v_new_hanchan_count
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.restore_jakuroku_backup_v2(p_target_group_id uuid, p_backup jsonb, p_member_map jsonb DEFAULT '{}'::jsonb, p_options jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_preview jsonb;
  v_source_group_id uuid;
  v_source_group_name text;
  v_trash jsonb;
  v_trash_backup jsonb;
  v_active_result jsonb := '{}'::jsonb;
  v_trash_result jsonb := '{}'::jsonb;
  v_active_run_id uuid;
  v_trash_run_id uuid;

  v_include_matches boolean;
  v_include_venues boolean;
  v_include_templates boolean;
  v_include_debts boolean;
  v_include_activity_logs boolean;
  v_include_trash boolean;

  v_item record;
  v_target_id uuid;
  v_debtor_id uuid;
  v_creditor_id uuid;
  v_target_session_id uuid;
  v_related_debt_id uuid;

  v_restored_venues integer := 0;
  v_restored_templates integer := 0;
  v_restored_debts integer := 0;
  v_restored_debt_events integer := 0;
  v_restored_activities integer := 0;
  v_restored_trash_sessions integer := 0;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です。';
  end if;

  if jsonb_typeof(p_options) <> 'object' then
    raise exception '復元オプションの形式が不正です。';
  end if;

  v_include_matches := coalesce(
    (p_options ->> 'include_matches')::boolean,
    true
  );

  v_include_venues := coalesce(
    (p_options ->> 'include_venues')::boolean,
    true
  );

  v_include_templates := coalesce(
    (p_options ->> 'include_templates')::boolean,
    true
  );

  v_include_debts := coalesce(
    (p_options ->> 'include_debts')::boolean,
    true
  );

  v_include_activity_logs := coalesce(
    (p_options ->> 'include_activity_logs')::boolean,
    false
  );

  v_include_trash := coalesce(
    (p_options ->> 'include_trash')::boolean,
    false
  );

  v_preview := public.preview_jakuroku_backup_v2(
    p_target_group_id,
    p_backup,
    p_member_map,
    p_options
  );

  v_source_group_id := (
    p_backup #>> '{group,id}'
  )::uuid;

  v_source_group_name := coalesce(
    p_backup #>> '{group,name}',
    ''
  );

  v_trash := p_backup #> '{tables,trash}';

  perform pg_advisory_xact_lock(
    hashtext(
      p_target_group_id::text
      || ':v2:'
      || v_source_group_id::text
    )::bigint
  );

  /*
    通常の対局記録。
    既存の復元関数を使用するため、v1形式との互換性も維持されます。
  */
  if v_include_matches then
    v_active_result := public.restore_jakuroku_backup(
      p_target_group_id,
      p_backup,
      p_member_map,
      p_options || jsonb_build_object(
        'backup_version', 2,
        'restore_section', 'active_matches'
      )
    );

    if coalesce(
      v_active_result ->> 'restore_run_id',
      ''
    ) <> '' then
      v_active_run_id := (
        v_active_result ->> 'restore_run_id'
      )::uuid;
    end if;
  end if;

  /*
    会場を先に復元し、後から対局へ対応付けます。
    同名の会場がすでにある場合、その会場を再利用します。
  */
  if v_include_venues then
    for v_item in
      select *
      from jsonb_to_recordset(
        p_backup #> '{tables,venues}'
      ) as v(
        id uuid,
        name text,
        note text,
        is_archived boolean,
        created_at timestamptz,
        updated_at timestamptz
      )
    loop
      if trim(coalesce(v_item.name, '')) = '' then
        raise exception '会場名が空のデータを復元できません。';
      end if;

      v_target_id := null;

      select restored_entity_id
      into v_target_id
      from public.backup_restore_entity_maps
      where target_group_id = p_target_group_id
        and source_group_id = v_source_group_id
        and entity_type = 'venue'
        and source_entity_id = v_item.id;

      if v_target_id is null then
        select id
        into v_target_id
        from public.match_venues
        where group_id = p_target_group_id
          and lower(name) = lower(
            left(
              regexp_replace(
                trim(v_item.name),
                '[[:space:]]+',
                ' ',
                'g'
              ),
              80
            )
          )
        limit 1;

        if v_target_id is null then
          insert into public.match_venues (
            group_id,
            name,
            note,
            is_archived,
            created_by,
            created_at,
            updated_at
          )
          values (
            p_target_group_id,
            left(
              regexp_replace(
                trim(v_item.name),
                '[[:space:]]+',
                ' ',
                'g'
              ),
              80
            ),
            left(trim(coalesce(v_item.note, '')), 200),
            coalesce(v_item.is_archived, false),
            auth.uid(),
            coalesce(v_item.created_at, now()),
            coalesce(v_item.updated_at, now())
          )
          returning id into v_target_id;

          v_restored_venues := v_restored_venues + 1;
        end if;

        insert into public.backup_restore_entity_maps (
          restore_run_id,
          target_group_id,
          source_group_id,
          entity_type,
          source_entity_id,
          restored_entity_id
        )
        values (
          v_active_run_id,
          p_target_group_id,
          v_source_group_id,
          'venue',
          v_item.id,
          v_target_id
        )
        on conflict (
          target_group_id,
          source_group_id,
          entity_type,
          source_entity_id
        ) do nothing;
      end if;
    end loop;
  end if;

  /*
    対局へ会場を割り当てます。
    今回新規作成された日次記録だけを対象とするため、
    既存データは上書きしません。
  */
  if v_include_venues and v_active_run_id is not null then
    update public.match_sessions target_session
    set venue_id = venue_map.restored_entity_id
    from public.backup_restore_session_map session_map
    join jsonb_to_recordset(
      p_backup #> '{tables,sessions}'
    ) as source_session(
      id uuid,
      venue_id uuid
    )
      on source_session.id = session_map.source_session_id
    join public.backup_restore_entity_maps venue_map
      on venue_map.target_group_id = p_target_group_id
      and venue_map.source_group_id = v_source_group_id
      and venue_map.entity_type = 'venue'
      and venue_map.source_entity_id = source_session.venue_id
    where session_map.restore_run_id = v_active_run_id
      and target_session.id = session_map.restored_session_id;
  end if;

  /*
    設定テンプレート。
    同名テンプレートがある場合は既存のものを再利用します。
  */
  if v_include_templates then
    for v_item in
      select *
      from jsonb_to_recordset(
        p_backup #> '{tables,templates}'
      ) as t(
        id uuid,
        name text,
        game_mode text,
        rate_label text,
        rate_multiplier numeric,
        starting_points integer,
        rule_settings jsonb,
        uma jsonb,
        chip_unit numeric,
        tobi_enabled boolean,
        created_at timestamptz,
        updated_at timestamptz
      )
    loop
      if trim(coalesce(v_item.name, '')) = '' then
        raise exception 'テンプレート名が空のデータを復元できません。';
      end if;

      v_target_id := null;

      select restored_entity_id
      into v_target_id
      from public.backup_restore_entity_maps
      where target_group_id = p_target_group_id
        and source_group_id = v_source_group_id
        and entity_type = 'template'
        and source_entity_id = v_item.id;

      if v_target_id is null then
        select id
        into v_target_id
        from public.match_setting_templates
        where group_id = p_target_group_id
          and lower(name) = lower(trim(v_item.name))
        limit 1;

        if v_target_id is null then
          insert into public.match_setting_templates (
            group_id,
            name,
            game_mode,
            rate_label,
            rate_multiplier,
            starting_points,
            rule_settings,
            uma,
            chip_unit,
            tobi_enabled,
            created_by,
            created_at,
            updated_at
          )
          values (
            p_target_group_id,
            left(trim(v_item.name), 80),
            v_item.game_mode,
            left(trim(v_item.rate_label), 80),
            v_item.rate_multiplier,
            v_item.starting_points,
            case when v_item.rule_settings is null then null else public.validate_match_rules_v70(v_item.rule_settings,case when v_item.game_mode='sanma' then 3 else 4 end,v_item.starting_points) end,
            v_item.uma,
            v_item.chip_unit,
            coalesce(v_item.tobi_enabled, false),
            auth.uid(),
            coalesce(v_item.created_at, now()),
            coalesce(v_item.updated_at, now())
          )
          returning id into v_target_id;

          v_restored_templates := v_restored_templates + 1;
        end if;

        insert into public.backup_restore_entity_maps (
          restore_run_id,
          target_group_id,
          source_group_id,
          entity_type,
          source_entity_id,
          restored_entity_id
        )
        values (
          v_active_run_id,
          p_target_group_id,
          v_source_group_id,
          'template',
          v_item.id,
          v_target_id
        )
        on conflict (
          target_group_id,
          source_group_id,
          entity_type,
          source_entity_id
        ) do nothing;
      end if;
    end loop;
  end if;

  /*
    ゴミ箱内の日次記録。
    通常の復元ロジックで一度複製してから、復元先で再びゴミ箱状態へ戻します。
  */
  if v_include_trash then
    v_trash_backup := jsonb_build_object(
      'format', 'jakuroku-backup-v2',
      'exported_at', p_backup ->> 'exported_at',
      'group', p_backup -> 'group',
      'tables', jsonb_build_object(
        'sessions', v_trash -> 'sessions',
        'members', p_backup #> '{tables,members}',
        'sessionMembers', v_trash -> 'sessionMembers',
        'hanchans', v_trash -> 'hanchans',
        'results', v_trash -> 'results',
        'chips', v_trash -> 'chips',
        'prepayments', v_trash -> 'prepayments',
        'tobiTransfers', v_trash -> 'tobiTransfers',
        'yakumans', v_trash -> 'yakumans'
      )
    );

    v_trash_result := public.restore_jakuroku_backup(
      p_target_group_id,
      v_trash_backup,
      p_member_map,
      p_options || jsonb_build_object(
        'backup_version', 2,
        'restore_section', 'trash_matches'
      )
    );

    if coalesce(
      v_trash_result ->> 'restore_run_id',
      ''
    ) <> '' then
      v_trash_run_id := (
        v_trash_result ->> 'restore_run_id'
      )::uuid;

      update public.match_sessions target_session
      set
        deleted_at = coalesce(
          source_session.deleted_at,
          now()
        ),
        deleted_by = auth.uid(),
        deleted_reason = left(
          trim(coalesce(
            source_session.deleted_reason,
            'バックアップから復元したゴミ箱記録'
          )),
          300
        )
      from public.backup_restore_session_map session_map
      join jsonb_to_recordset(
        v_trash -> 'sessions'
      ) as source_session(
        id uuid,
        deleted_at timestamptz,
        deleted_reason text
      )
        on source_session.id = session_map.source_session_id
      where session_map.restore_run_id = v_trash_run_id
        and target_session.id = session_map.restored_session_id;

      if v_include_venues then
        update public.match_sessions target_session
        set venue_id = venue_map.restored_entity_id
        from public.backup_restore_session_map session_map
        join jsonb_to_recordset(
          v_trash -> 'sessions'
        ) as source_session(
          id uuid,
          venue_id uuid
        )
          on source_session.id = session_map.source_session_id
        join public.backup_restore_entity_maps venue_map
          on venue_map.target_group_id = p_target_group_id
          and venue_map.source_group_id = v_source_group_id
          and venue_map.entity_type = 'venue'
          and venue_map.source_entity_id = source_session.venue_id
        where session_map.restore_run_id = v_trash_run_id
          and target_session.id = session_map.restored_session_id;
      end if;

      select count(*)
      into v_restored_trash_sessions
      from public.backup_restore_session_map
      where restore_run_id = v_trash_run_id;
    end if;
  end if;

  /*
    借pt。
    取消済みの借ptは「ゴミ箱を復元」が選択された場合だけ復元されます。
  */
  if v_include_debts or v_include_trash then
    for v_item in
      select *
      from jsonb_to_recordset(
        p_backup #> '{tables,debtRecords}'
      ) as d(
        id uuid,
        source_session_id uuid,
        debtor_member_id uuid,
        creditor_member_id uuid,
        original_amount_pt numeric,
        remaining_amount_pt numeric,
        status text,
        record_kind text,
        memo text,
        due_date date,
        paid_at timestamptz,
        cancelled_at timestamptz,
        cancelled_reason text,
        created_at timestamptz,
        updated_at timestamptz
      )
    loop
      if v_item.status = 'cancelled'
         and not v_include_trash then
        continue;
      end if;

      if v_item.status <> 'cancelled'
         and not v_include_debts then
        continue;
      end if;

      if v_item.status not in (
        'open',
        'paid',
        'rerouted',
        'offset',
        'cancelled'
      ) then
        raise exception '借ptの状態が不正です。';
      end if;

      if v_item.record_kind not in (
        'manual',
        'settlement',
        'reroute'
      ) then
        raise exception '借ptの種別が不正です。';
      end if;

      if coalesce(v_item.original_amount_pt, 0) <= 0
         or coalesce(v_item.remaining_amount_pt, 0) < 0 then
        raise exception '借ptの金額が不正です。';
      end if;

      v_target_id := null;

      select restored_entity_id
      into v_target_id
      from public.backup_restore_entity_maps
      where target_group_id = p_target_group_id
        and source_group_id = v_source_group_id
        and entity_type = 'debt'
        and source_entity_id = v_item.id;

      if v_target_id is not null then
        continue;
      end if;

      select id
      into v_debtor_id
      from public.group_members
      where group_id = p_target_group_id
        and id::text = coalesce(
          p_member_map ->> v_item.debtor_member_id::text,
          v_item.debtor_member_id::text
        )
      limit 1;

      select id
      into v_creditor_id
      from public.group_members
      where group_id = p_target_group_id
        and id::text = coalesce(
          p_member_map ->> v_item.creditor_member_id::text,
          v_item.creditor_member_id::text
        )
      limit 1;

      if v_debtor_id is null or v_creditor_id is null then
        raise exception '借ptの参加メンバー対応付けが完了していません。';
      end if;

      v_target_session_id := null;

      if v_item.source_session_id is not null then
        select restored_session_id
        into v_target_session_id
        from public.backup_restore_session_map
        where target_group_id = p_target_group_id
          and source_group_id = v_source_group_id
          and source_session_id = v_item.source_session_id
        limit 1;
      end if;

      v_target_id := gen_random_uuid();

      insert into public.debt_records (
        id,
        group_id,
        source_session_id,
        debtor_member_id,
        creditor_member_id,
        original_amount_pt,
        remaining_amount_pt,
        status,
        record_kind,
        memo,
        due_date,
        paid_at,
        cancelled_at,
        cancelled_by,
        cancelled_reason,
        created_at,
        updated_at
      )
      values (
        v_target_id,
        p_target_group_id,
        v_target_session_id,
        v_debtor_id,
        v_creditor_id,
        v_item.original_amount_pt,
        v_item.remaining_amount_pt,
        v_item.status,
        v_item.record_kind,
        left(trim(coalesce(v_item.memo, '')), 300),
        v_item.due_date,
        v_item.paid_at,
        v_item.cancelled_at,
        case
          when v_item.status = 'cancelled' then auth.uid()
          else null
        end,
        left(trim(coalesce(v_item.cancelled_reason, '')), 300),
        coalesce(v_item.created_at, now()),
        coalesce(v_item.updated_at, now())
      );

      insert into public.backup_restore_entity_maps (
        restore_run_id,
        target_group_id,
        source_group_id,
        entity_type,
        source_entity_id,
        restored_entity_id
      )
      values (
        coalesce(v_active_run_id, v_trash_run_id),
        p_target_group_id,
        v_source_group_id,
        'debt',
        v_item.id,
        v_target_id
      );

      v_restored_debts := v_restored_debts + 1;
    end loop;

    for v_item in
      select *
      from jsonb_to_recordset(
        p_backup #> '{tables,debtEvents}'
      ) as e(
        id uuid,
        debt_id uuid,
        event_type text,
        amount_pt numeric,
        related_debt_id uuid,
        note text,
        occurred_at timestamptz
      )
    loop
      v_target_id := null;

      select restored_entity_id
      into v_target_id
      from public.backup_restore_entity_maps
      where target_group_id = p_target_group_id
        and source_group_id = v_source_group_id
        and entity_type = 'debt_event'
        and source_entity_id = v_item.id;

      if v_target_id is not null then
        continue;
      end if;

      select restored_entity_id
      into v_target_session_id
      from public.backup_restore_entity_maps
      where target_group_id = p_target_group_id
        and source_group_id = v_source_group_id
        and entity_type = 'debt'
        and source_entity_id = v_item.debt_id;

      if v_target_session_id is null then
        continue;
      end if;

      v_related_debt_id := null;

      if v_item.related_debt_id is not null then
        select restored_entity_id
        into v_related_debt_id
        from public.backup_restore_entity_maps
        where target_group_id = p_target_group_id
          and source_group_id = v_source_group_id
          and entity_type = 'debt'
          and source_entity_id = v_item.related_debt_id;
      end if;

      v_target_id := gen_random_uuid();

      insert into public.debt_events (
        id,
        group_id,
        debt_id,
        event_type,
        amount_pt,
        related_debt_id,
        note,
        occurred_at
      )
      values (
        v_target_id,
        p_target_group_id,
        v_target_session_id,
        v_item.event_type,
        v_item.amount_pt,
        v_related_debt_id,
        left(trim(coalesce(v_item.note, '')), 300),
        coalesce(v_item.occurred_at, now())
      );

      insert into public.backup_restore_entity_maps (
        restore_run_id,
        target_group_id,
        source_group_id,
        entity_type,
        source_entity_id,
        restored_entity_id
      )
      values (
        coalesce(v_active_run_id, v_trash_run_id),
        p_target_group_id,
        v_source_group_id,
        'debt_event',
        v_item.id,
        v_target_id
      );

      v_restored_debt_events := v_restored_debt_events + 1;
    end loop;
  end if;

  /*
    編集履歴。
    復元した履歴は、元の操作日時を維持しつつ、
    復元元の詳細を記録した履歴として保存します。
  */
  if v_include_activity_logs then
    for v_item in
      select *
      from jsonb_to_recordset(
        p_backup #> '{tables,activityLogs}'
      ) as a(
        id uuid,
        actor_user_id uuid,
        event_type text,
        entity_type text,
        entity_id uuid,
        summary text,
        details jsonb,
        created_at timestamptz
      )
    loop
      v_target_id := null;

      select restored_entity_id
      into v_target_id
      from public.backup_restore_entity_maps
      where target_group_id = p_target_group_id
        and source_group_id = v_source_group_id
        and entity_type = 'activity'
        and source_entity_id = v_item.id;

      if v_target_id is not null then
        continue;
      end if;

      v_target_id := gen_random_uuid();

      insert into public.group_activity_logs (
        id,
        group_id,
        actor_user_id,
        event_type,
        entity_type,
        entity_id,
        summary,
        details,
        created_at
      )
      values (
        v_target_id,
        p_target_group_id,
        auth.uid(),
        'backup_restored',
        'group',
        p_target_group_id,
        left(
          '復元済み履歴：'
          || regexp_replace(
            trim(coalesce(v_item.summary, '操作履歴')),
            '[[:space:]]+',
            ' ',
            'g'
          ),
          240
        ),
        jsonb_build_object(
          'source_group_id', v_source_group_id,
          'source_group_name', v_source_group_name,
          'source_activity_id', v_item.id,
          'source_event_type', v_item.event_type,
          'source_entity_type', v_item.entity_type,
          'source_entity_id', v_item.entity_id,
          'source_actor_user_id', v_item.actor_user_id,
          'source_details', coalesce(
            v_item.details,
            '{}'::jsonb
          )
        ),
        coalesce(v_item.created_at, now())
      );

      insert into public.backup_restore_entity_maps (
        restore_run_id,
        target_group_id,
        source_group_id,
        entity_type,
        source_entity_id,
        restored_entity_id
      )
      values (
        coalesce(v_active_run_id, v_trash_run_id),
        p_target_group_id,
        v_source_group_id,
        'activity',
        v_item.id,
        v_target_id
      );

      v_restored_activities := v_restored_activities + 1;
    end loop;
  end if;

  perform public.record_group_activity(
    p_target_group_id,
    'backup_restored',
    'group',
    p_target_group_id,
    format(
      '拡張JSONバックアップを復元しました。対局%s日分、会場%s件、テンプレート%s件、借pt%s件。',
      coalesce(
        (v_active_result ->> 'restored_session_count')::integer,
        0
      ),
      v_restored_venues,
      v_restored_templates,
      v_restored_debts
    ),
    jsonb_build_object(
      'backup_version', 2,
      'source_group_id', v_source_group_id,
      'source_group_name', v_source_group_name,
      'include_matches', v_include_matches,
      'include_venues', v_include_venues,
      'include_templates', v_include_templates,
      'include_debts', v_include_debts,
      'include_activity_logs', v_include_activity_logs,
      'include_trash', v_include_trash,
      'restored_venues', v_restored_venues,
      'restored_templates', v_restored_templates,
      'restored_debts', v_restored_debts,
      'restored_debt_events', v_restored_debt_events,
      'restored_activities', v_restored_activities,
      'restored_trash_sessions', v_restored_trash_sessions
    )
  );

  return jsonb_build_object(
    'message', '拡張JSONバックアップを復元しました。',
    'active_matches', v_active_result,
    'trash_matches', v_trash_result,
    'restored_venues', v_restored_venues,
    'restored_templates', v_restored_templates,
    'restored_debts', v_restored_debts,
    'restored_debt_events', v_restored_debt_events,
    'restored_activities', v_restored_activities,
    'restored_trash_sessions', v_restored_trash_sessions
  );
end;
$function$;
