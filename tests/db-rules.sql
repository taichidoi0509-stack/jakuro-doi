-- Run as a transaction: all fixture records are rolled back.
BEGIN;
SELECT set_config('request.jwt.claim.sub',(SELECT gm.user_id::text FROM public.group_members gm WHERE gm.user_id IS NOT NULL AND (SELECT count(*) FROM public.group_members m WHERE m.group_id=gm.group_id)>=4 LIMIT 1),true);
SET LOCAL ROLE authenticated;
DO $test$
DECLARE g uuid; m jsonb; sid uuid; hid uuid; tid uuid; results jsonb; chips jsonb; denied boolean:=false;
BEGIN
 SELECT gm.group_id INTO g FROM public.group_members gm WHERE gm.user_id=auth.uid() AND (SELECT count(*) FROM public.group_members x WHERE x.group_id=gm.group_id)>=4 LIMIT 1;
 SELECT jsonb_agg(id ORDER BY id) INTO m FROM (SELECT id FROM public.group_members WHERE group_id=g ORDER BY id LIMIT 4)x;
 sid:=public.create_match_session_v70(g,current_date,'yonma','検証',200,25000,4,'[40,10,-10,-20]',false,m,'rollback','{"return_points":30000,"oka":20,"base_uma":[20,10,-10,-20],"tie_policy":"split","chip_enabled":false}');
 SELECT jsonb_agg(jsonb_build_object('member_id',value,'rank',ordinality,'final_points',(ARRAY[40000,40000,10000,10000])[ordinality])) INTO results FROM jsonb_array_elements_text(m) WITH ORDINALITY;
 hid:=public.add_match_hanchan_v70(sid,'[25,25,-15,-15]',results,'[]','','[]','[40,10,-10,-20]');
 IF (SELECT array_agg(total_points ORDER BY rank) FROM public.match_hanchan_results WHERE hanchan_id=hid)<>ARRAY[35,35,-35,-35]::numeric[] THEN RAISE EXCEPTION 'split score mismatch'; END IF;
 IF (SELECT input_uma FROM public.match_hanchans WHERE id=hid)<>'[40,10,-10,-20]'::jsonb THEN RAISE EXCEPTION 'input bonuses not retained'; END IF;
 SELECT jsonb_agg(jsonb_build_object('member_id',value,'rank',ordinality,'final_points',(ARRAY[40000,30000,20000,10000])[ordinality])) INTO results FROM jsonb_array_elements_text(m) WITH ORDINALITY;
 PERFORM public.update_match_hanchan_v70(hid,'[40,10,-10,-20]',results,'[]','','[]','[40,10,-10,-20]');
 IF (SELECT array_agg(total_points ORDER BY rank) FROM public.match_hanchan_results WHERE hanchan_id=hid)<>ARRAY[50,10,-20,-40]::numeric[] THEN RAISE EXCEPTION 'edit score mismatch'; END IF;
 SELECT jsonb_agg(jsonb_build_object('member_id',value,'chip_count',0)) INTO chips FROM jsonb_array_elements_text(m);
 BEGIN PERFORM public.set_match_session_chips(sid,chips); EXCEPTION WHEN OTHERS THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'disabled chips allowed'; END IF;
 tid:=public.create_match_setting_template_v70(g,'検証','yonma','検証',200,25000,'[40,10,-10,-20]',4,false,'{"return_points":30000,"oka":20,"base_uma":[20,10,-10,-20],"tie_policy":"manual","chip_enabled":false}');
 PERFORM public.update_match_setting_template_v70(tid,'検証','yonma','検証',200,25000,'[40,10,-10,-20]',4,false,'{"return_points":30000,"oka":20,"base_uma":[20,10,-10,-20],"tie_policy":"split","chip_enabled":true}');
 IF (SELECT rule_settings->>'tie_policy' FROM public.match_setting_templates WHERE id=tid)<>'split' THEN RAISE EXCEPTION 'template mismatch'; END IF;
 denied:=false;
 BEGIN PERFORM public.validate_match_rules_v70('{"return_points":30000,"oka":10,"base_uma":[20,10,-10,-20],"tie_policy":"split","chip_enabled":true}',4,25000); EXCEPTION WHEN OTHERS THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'unbalanced rules allowed'; END IF;
 denied:=false;
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 BEGIN PERFORM public.create_match_session_v70(g,current_date,'yonma','test',30,25000,0,'[0,0,0,0]',false,m,'','{"return_points":25000,"oka":0,"base_uma":[0,0,0,0],"tie_policy":"split","chip_enabled":false}'); EXCEPTION WHEN OTHERS THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'outsider write allowed'; END IF;
END $test$;
ROLLBACK;
SELECT 'PASS: authenticated create/add/edit/template/chip toggle/invalid balance/outsider; rolled back' AS result;
