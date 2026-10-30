BEGIN;
SELECT set_config('request.jwt.claim.sub',(SELECT gm.user_id::text FROM public.group_members gm WHERE gm.role='admin' AND gm.user_id IS NOT NULL AND (SELECT count(*) FROM public.group_members m WHERE m.group_id=gm.group_id)>=4 LIMIT 1),true);
SET LOCAL ROLE authenticated;
DO $test$
DECLARE g uuid; m jsonb; sid uuid; hid uuid; results jsonb; backup jsonb; response jsonb; restored uuid; restored_h uuid; source_group uuid:=gen_random_uuid(); tid uuid;
BEGIN
 SELECT gm.group_id INTO g FROM public.group_members gm WHERE gm.user_id=auth.uid() AND gm.role='admin' AND (SELECT count(*) FROM public.group_members x WHERE x.group_id=gm.group_id)>=4 LIMIT 1;
 SELECT jsonb_agg(id ORDER BY id) INTO m FROM (SELECT id FROM public.group_members WHERE group_id=g ORDER BY id LIMIT 4)x;
 sid:=public.create_match_session_v70(g,current_date,'yonma','検証',30,25000,4,'[40,10,-10,-20]',false,m,'rollback',jsonb_build_object('return_points',30000,'oka',20,'base_uma','[20,10,-10,-20]'::jsonb,'tie_policy','seat','chip_enabled',false,'seat_order',m));
 SELECT jsonb_agg(jsonb_build_object('member_id',value,'rank',ordinality,'final_points',(ARRAY[40000,30000,20000,10000])[ordinality])) INTO results FROM jsonb_array_elements_text(m) WITH ORDINALITY;
 hid:=public.add_match_hanchan_v70(sid,'[40,10,-10,-20]',results,'[]','','[]','[40,10,-10,-20]');
 tid:=public.create_match_setting_template_v70(g,'復元元テスト','yonma','検証',30,25000,'[40,10,-10,-20]',0,false,'{"return_points":30000,"oka":20,"base_uma":[20,10,-10,-20],"tie_policy":"manual","chip_enabled":false}');
 backup:=jsonb_build_object('format','jakuroku-backup-v2','exported_at',now(),'group',jsonb_build_object('id',source_group,'name','検証'), 'tables',jsonb_build_object(
 'sessions',(SELECT jsonb_agg(to_jsonb(s)) FROM public.match_sessions s WHERE id=sid),
 'sessionMembers',(SELECT jsonb_agg(to_jsonb(s)) FROM public.match_session_members s WHERE session_id=sid),
 'members',(SELECT jsonb_agg(to_jsonb(s)) FROM public.group_members s WHERE group_id=g),
 'hanchans',(SELECT jsonb_agg(to_jsonb(s)) FROM public.match_hanchans s WHERE id=hid),
 'results',(SELECT jsonb_agg(to_jsonb(s)) FROM public.match_hanchan_results s WHERE hanchan_id=hid),
 'templates',(SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('name','復元先テスト')) FROM public.match_setting_templates s WHERE id=tid),
 'chips','[]'::jsonb,'prepayments','[]'::jsonb,'tobiTransfers','[]'::jsonb,'yakumans','[]'::jsonb,'venues','[]'::jsonb,'debtRecords','[]'::jsonb,'debtEvents','[]'::jsonb,'activityLogs','[]'::jsonb,'trash',jsonb_build_object('sessions','[]'::jsonb,'sessionMembers','[]'::jsonb,'hanchans','[]'::jsonb,'results','[]'::jsonb,'chips','[]'::jsonb,'prepayments','[]'::jsonb,'tobiTransfers','[]'::jsonb,'yakumans','[]'::jsonb)));
 response:=public.restore_jakuroku_backup_v2(g,backup,'{}','{"include_matches":true,"include_templates":true,"include_venues":false,"include_debts":false,"include_activity_logs":false,"include_trash":false}');
 SELECT restored_session_id INTO restored FROM public.backup_restore_session_map WHERE source_group_id=source_group AND source_session_id=sid AND target_group_id=g;
 IF restored IS NULL THEN RAISE EXCEPTION 'restore failed: %',response; END IF;
 IF (SELECT rule_settings FROM public.match_sessions WHERE id=restored) IS DISTINCT FROM (SELECT rule_settings FROM public.match_sessions WHERE id=sid) THEN RAISE EXCEPTION 'restored rule mismatch'; END IF;
 SELECT id INTO restored_h FROM public.match_hanchans WHERE session_id=restored;
 IF (SELECT input_uma FROM public.match_hanchans WHERE id=restored_h)<>'[40,10,-10,-20]'::jsonb THEN RAISE EXCEPTION 'restored input bonuses'; END IF;
 IF (SELECT rule_settings->>'tie_policy' FROM public.match_setting_templates WHERE group_id=g AND name='復元先テスト') IS DISTINCT FROM 'manual' THEN RAISE EXCEPTION 'restored template rules'; END IF;
 IF (SELECT array_agg(total_points ORDER BY rank) FROM public.match_hanchan_results WHERE hanchan_id=restored_h)<>ARRAY[50,10,-20,-40]::numeric[] THEN RAISE EXCEPTION 'restored score'; END IF;
END $test$;
ROLLBACK;
SELECT 'PASS: v2 backup restore retains rules, priority order, input bonuses, template rules, results; rolled back' AS result;
