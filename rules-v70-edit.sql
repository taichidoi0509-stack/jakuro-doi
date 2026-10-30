-- Preserve the entered rank bonuses independently of the split bonuses saved
-- for a tied finish, so a later edit can correctly resolve a previous tie.
ALTER TABLE public.match_hanchans ADD COLUMN input_uma jsonb;
CREATE OR REPLACE FUNCTION moriken_private.save_hanchan_input_v70(p_hanchan_id uuid,p_input_uma jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid; n integer;
BEGIN
 SELECT session_id INTO sid FROM public.match_hanchans WHERE id=p_hanchan_id;
 IF auth.uid() IS NULL OR sid IS NULL OR NOT EXISTS (SELECT 1 FROM public.match_sessions s WHERE s.id=sid AND public.is_group_member(s.group_id)) THEN RAISE EXCEPTION '半荘を編集する権限がありません。'; END IF;
 SELECT count(*) INTO n FROM public.match_session_members WHERE session_id=sid;
 IF jsonb_typeof(p_input_uma) IS DISTINCT FROM 'array' OR jsonb_array_length(p_input_uma)<>n THEN RAISE EXCEPTION '順位点の人数が一致しません。'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_input_uma) x WHERE x.value IS NULL OR abs(x.value::numeric)>20000 OR x.value::numeric<>round(x.value::numeric,1)) THEN RAISE EXCEPTION '順位点が不正です。'; END IF;
 UPDATE public.match_hanchans SET input_uma=p_input_uma WHERE id=p_hanchan_id;
END $$;
REVOKE ALL ON FUNCTION moriken_private.save_hanchan_input_v70(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION moriken_private.save_hanchan_input_v70(uuid,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.add_match_hanchan_v70(p_session_id uuid,p_uma jsonb,p_results jsonb,p_tobi_transfers jsonb,p_notes text,p_yakuman_records jsonb,p_input_uma jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE hid uuid;
BEGIN
 hid:=public.add_match_hanchan(p_session_id,p_uma,p_results,p_tobi_transfers,p_notes,p_yakuman_records);
 PERFORM moriken_private.save_hanchan_input_v70(hid,p_input_uma);
 RETURN hid;
END $$;
REVOKE ALL ON FUNCTION public.add_match_hanchan_v70(uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_match_hanchan_v70(uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.update_match_hanchan_v70(p_hanchan_id uuid,p_uma jsonb,p_results jsonb,p_tobi_transfers jsonb,p_notes text,p_yakuman_records jsonb,p_input_uma jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM public.update_match_hanchan(p_hanchan_id,p_uma,p_results,p_tobi_transfers,p_notes,p_yakuman_records);
 PERFORM moriken_private.save_hanchan_input_v70(p_hanchan_id,p_input_uma);
END $$;
REVOKE ALL ON FUNCTION public.update_match_hanchan_v70(uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_match_hanchan_v70(uuid,jsonb,jsonb,jsonb,text,jsonb,jsonb) TO authenticated;
