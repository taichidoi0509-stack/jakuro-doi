CREATE OR REPLACE FUNCTION public.set_match_session_chips(p_session_id uuid, p_chip_results jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session public.match_sessions%rowtype;
  v_expected_count integer;
  v_chip_count integer;
  v_distinct_member_count integer;
  v_chip_total numeric;
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

  if v_session.rule_settings->>'chip_enabled' = 'false' then
    raise exception 'この対局ではチップを使用しません。';
  end if;

  if jsonb_typeof(p_chip_results) <> 'array' then
    raise exception 'チップの形式が不正です。';
  end if;

  select count(*)
  into v_expected_count
  from public.match_session_members
  where session_id = p_session_id;

  select
    count(*),
    count(distinct member_id),
    coalesce(sum(chip_count), 0)
  into
    v_chip_count,
    v_distinct_member_count,
    v_chip_total
  from jsonb_to_recordset(p_chip_results) as c(
    member_id uuid,
    chip_count numeric
  );

  if v_chip_count <> v_expected_count
     or v_distinct_member_count <> v_expected_count then
    raise exception '全参加者のチップを入力してください。';
  end if;

  if round(v_chip_total, 1) <> 0 then
    raise exception 'チップ合計は0枚にしてください。';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_chip_results) as c(
      member_id uuid,
      chip_count numeric
    )
    left join public.match_session_members sm
      on sm.session_id = p_session_id
      and sm.member_id = c.member_id
    where sm.member_id is null
      or c.chip_count is null
  ) then
    raise exception 'チップの内容が不正です。';
  end if;

  insert into public.match_session_chips (
    session_id,
    member_id,
    chip_count
  )
  select
    p_session_id,
    member_id,
    chip_count
  from jsonb_to_recordset(p_chip_results) as c(
    member_id uuid,
    chip_count numeric
  )
  on conflict (session_id, member_id)
  do update set
    chip_count = excluded.chip_count,
    updated_at = now();
end;
$function$
