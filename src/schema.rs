// Consolidated Diesel schema for all modules.

// ── Auth ─────────────────────────────────────────────────────────────────────

diesel::table! {
    users (id) {
        id -> Text,
        email -> Text,
        name -> Text,
        password_hash -> Text,
        created_at -> Timestamp,
        role -> Text,
        totp_secret -> Nullable<Text>,
        totp_enabled -> Integer,
        deleted_at -> Nullable<Timestamp>,
        // Added in migration 005
        public_key -> Nullable<Text>,
    }
}

diesel::table! {
    refresh_tokens (id) {
        id -> Text,
        user_id -> Text,
        token_hash -> Text,
        expires_at -> Timestamp,
        created_at -> Timestamp,
        device_name -> Nullable<Text>,
        user_agent -> Nullable<Text>,
        ip_address -> Nullable<Text>,
        last_used_at -> Nullable<Timestamp>,
    }
}

diesel::table! {
    totp_backup_codes (id) {
        id -> Text,
        user_id -> Text,
        code_hash -> Text,
        used_at -> Nullable<Timestamp>,
        created_at -> Timestamp,
    }
}

diesel::table! {
    user_profiles (user_id) {
        user_id -> Text,
        theme -> Nullable<Text>,
        bio -> Nullable<Text>,
        avatar -> Nullable<Text>,
        profile_image -> Nullable<Text>,
        website -> Nullable<Text>,
        social_links -> Nullable<Text>,
        language -> Nullable<Text>,
        timezone -> Nullable<Text>,
        country -> Nullable<Text>,
        email_marketing -> Integer,
        email_general -> Integer,
        email_updates -> Integer,
        email_critical -> Integer,
        updated_at -> Timestamp,
    }
}

// ── Calendar ─────────────────────────────────────────────────────────────────

diesel::table! {
    events (id) {
        id -> Text,
        user_id -> Text,
        title -> Text,
        description -> Nullable<Text>,
        start_time -> Timestamp,
        end_time -> Timestamp,
        all_day -> Bool,
        location -> Nullable<Text>,
        recurrence_rule -> Nullable<Text>,
        external_id -> Nullable<Text>,
        source -> Text,
        created_at -> Timestamp,
        updated_at -> Timestamp,
        timezone -> Nullable<Text>,
    }
}

diesel::table! {
    reminders (id) {
        id -> Text,
        user_id -> Text,
        title -> Text,
        due_time -> Timestamp,
        completed -> Bool,
        recurrence_rule -> Nullable<Text>,
        linked_event_id -> Nullable<Text>,
        notified_at -> Nullable<Timestamp>,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    event_attachments (id) {
        id -> Text,
        event_id -> Text,
        file_id -> Nullable<Text>,
        name -> Nullable<Text>,
        note -> Nullable<Text>,
    }
}

diesel::table! {
    event_attendees (id) {
        id -> Text,
        event_id -> Text,
        email -> Text,
    }
}

diesel::table! {
    calendar_connections (id) {
        id -> Text,
        user_id -> Text,
        provider -> Text,
        access_token -> Text,
        refresh_token -> Nullable<Text>,
        expires_at -> Nullable<Timestamp>,
        sync_cursor -> Nullable<Text>,
        created_at -> Timestamp,
        updated_at -> Timestamp,
        email -> Nullable<Text>,
        caldav_url -> Nullable<Text>,
    }
}

diesel::table! {
    task_lists (id) {
        id -> Text,
        user_id -> Text,
        name -> Text,
        color -> Nullable<Text>,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    tasks (id) {
        id -> Text,
        user_id -> Text,
        title -> Text,
        notes -> Nullable<Text>,
        done -> Bool,
        due_date -> Nullable<Timestamp>,
        position -> Integer,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    task_list_memberships (task_id, list_id) {
        task_id -> Text,
        list_id -> Text,
    }
}

// ── Docs ─────────────────────────────────────────────────────────────────────

diesel::table! {
    docs (file_id) {
        file_id -> Text,
        page_setup -> Text,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    doc_yjs_state (file_id) {
        file_id -> Text,
        state -> Binary,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    doc_templates (id) {
        id -> Text,
        name -> Text,
        description -> Nullable<Text>,
        is_system -> Integer,
        is_default -> Integer,
        category -> Nullable<Text>,
        content_json -> Text,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

// ── Notes ────────────────────────────────────────────────────────────────────

diesel::table! {
    notes (file_id) {
        file_id -> Text,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    note_links (source_note_id, target_note_id) {
        source_note_id -> Text,
        target_note_id -> Text,
        created_at -> Timestamp,
    }
}

// ── Photos ───────────────────────────────────────────────────────────────────

diesel::table! {
    photos (id) {
        id -> Text,
        user_id -> Text,
        file_id -> Text,
        is_starred -> Bool,
        is_archived -> Bool,
        deleted_at -> Nullable<Timestamp>,
        capture_date -> Nullable<Timestamp>,
        metadata -> Nullable<Text>,
        created_at -> Timestamp,
        updated_at -> Timestamp,
        is_locked -> Integer,
        strip_gps -> Integer,
    }
}

diesel::table! {
    photo_edits (photo_id) {
        photo_id -> Text,
        edits_json -> Text,
        preview_storage_path -> Nullable<Text>,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    locked_folder_settings (user_id) {
        user_id -> Text,
        is_enabled -> Integer,
        pin_hash -> Nullable<Text>,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    albums (id) {
        id -> Text,
        user_id -> Text,
        title -> Text,
        description -> Nullable<Text>,
        is_auto -> Bool,
        person_id -> Nullable<Text>,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    album_photos (album_id, photo_id) {
        album_id -> Text,
        photo_id -> Text,
        added_at -> Timestamp,
    }
}

diesel::table! {
    faces (id) {
        id -> Text,
        photo_id -> Text,
        bounding_box -> Text,
        thumbnail -> Nullable<Text>,
        thumbnail_mime_type -> Nullable<Text>,
        person_id -> Nullable<Text>,
        embedding -> Nullable<Text>,
        created_at -> Timestamp,
    }
}

diesel::table! {
    face_suggestions (id) {
        id -> Text,
        face_id -> Text,
        person_id -> Text,
        confidence -> Float,
        status -> Text,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    training_signals (id) {
        id -> Text,
        user_id -> Text,
        face_id -> Text,
        person_id -> Text,
        action -> Text,
        processed -> Bool,
        created_at -> Timestamp,
    }
}

diesel::table! {
    user_recognition_thresholds (user_id) {
        user_id -> Text,
        auto_tag_threshold -> Float,
        suggest_threshold -> Float,
        total_accepts -> Integer,
        total_rejects -> Integer,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    persons (id) {
        id -> Text,
        user_id -> Text,
        cover_face_id -> Nullable<Text>,
        cover_thumbnail -> Nullable<Text>,
        cover_thumbnail_mime_type -> Nullable<Text>,
        face_count -> Integer,
        name -> Nullable<Text>,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

// ── Sheets ───────────────────────────────────────────────────────────────────

diesel::table! {
    sheets (file_id) {
        file_id -> Text,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    named_ranges (id) {
        id -> Text,
        sheet_db_id -> Text,
        sheet_id -> Text,
        start_row -> Integer,
        start_col -> Integer,
        end_row -> Integer,
        end_col -> Integer,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

// ── Slides ───────────────────────────────────────────────────────────────────

diesel::table! {
    slides (file_id) {
        file_id -> Text,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    slide_themes (id) {
        id -> Text,
        user_id -> Text,
        name -> Text,
        primary_color -> Text,
        background_color -> Text,
        text_color -> Text,
        accent_color -> Text,
        font_family -> Text,
        background_image -> Nullable<Text>,
        gradient_background -> Nullable<Text>,
        default_transition -> Text,
        created_at -> Timestamp,
        updated_at -> Timestamp,
        is_system -> Bool,
    }
}

// ── Drive ────────────────────────────────────────────────────────────────────

diesel::table! {
    folders (id) {
        id -> Text,
        user_id -> Text,
        parent_id -> Nullable<Text>,
        name -> Text,
        is_starred -> Bool,
        color -> Nullable<Text>,
        deleted_at -> Nullable<Timestamp>,
        created_at -> Timestamp,
        updated_at -> Timestamp,
        // Added in migration 021
        starred_at -> Nullable<Timestamp>,
        // Added in migration 027
        shared_drive_id -> Nullable<Text>,
    }
}

diesel::table! {
    files (id) {
        id -> Text,
        user_id -> Text,
        name -> Text,
        size_bytes -> BigInt,
        mime_type -> Text,
        storage_path -> Text,
        created_at -> Timestamp,
        updated_at -> Timestamp,
        // Added in migration 005
        folder_id -> Nullable<Text>,
        is_starred -> Bool,
        deleted_at -> Nullable<Timestamp>,
        // Added in migration 020
        cover_thumbnail -> Nullable<Text>,
        cover_thumbnail_mime_type -> Nullable<Text>,
        // Added in migration 021
        starred_at -> Nullable<Timestamp>,
        // Added in migration 027
        shared_drive_id -> Nullable<Text>,
        // Added in migration 037
        encrypted_metadata -> Nullable<Text>,
    }
}

diesel::table! {
    user_quotas (user_id) {
        user_id -> Text,
        used_bytes -> BigInt,
        daily_upload_bytes -> BigInt,
        daily_reset_at -> Timestamp,
        quota_bytes -> Nullable<BigInt>,
        daily_cap_bytes -> Nullable<BigInt>,
    }
}

diesel::table! {
    shortcuts (id) {
        id -> Text,
        user_id -> Text,
        target_file_id -> Text,
        folder_id -> Nullable<Text>,
        created_at -> Timestamp,
    }
}

diesel::table! {
    file_versions (id) {
        id -> Text,
        file_id -> Text,
        user_id -> Text,
        version_number -> Integer,
        size_bytes -> BigInt,
        storage_path -> Text,
        label -> Nullable<Text>,
        created_at -> Timestamp,
        // Added in migration 034
        is_named -> Bool,
    }
}

diesel::table! {
    share_links (id) {
        id -> Text,
        resource_type -> Text,
        resource_id -> Text,
        token -> Text,
        visibility -> Text,
        role -> Text,
        expires_at -> Nullable<Timestamp>,
        is_active -> Bool,
        created_by -> Text,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    permissions (id) {
        id -> Text,
        resource_type -> Text,
        resource_id -> Text,
        user_id -> Text,
        role -> Text,
        granted_by -> Text,
        created_at -> Timestamp,
        // Added in migration 010
        user_email -> Text,
        user_name -> Text,
    }
}

diesel::table! {
    access_requests (id) {
        id -> Text,
        resource_type -> Text,
        resource_id -> Text,
        requester_id -> Text,
        requester_email -> Text,
        requester_name -> Text,
        message -> Nullable<Text>,
        requested_role -> Text,
        status -> Text,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    irm_policies (id) {
        id -> Text,
        resource_type -> Text,
        resource_id -> Text,
        restrict_download_viewer -> Bool,
        restrict_download_commenter -> Bool,
        restrict_download_editor -> Bool,
        restrict_print_copy_viewer -> Bool,
        restrict_print_copy_commenter -> Bool,
        restrict_print_copy_editor -> Bool,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    workspace_settings (id) {
        id -> Text,
        allowed_domain -> Nullable<Text>,
        restrict_shares_to_domain -> Bool,
        block_external_link_sharing -> Bool,
        domain_only_links -> Bool,
        created_at -> Timestamp,
        updated_at -> Timestamp,
        // Added in migration 033
        require_2fa -> Integer,
        default_restrict_download_viewer -> Integer,
        default_restrict_print_copy_viewer -> Integer,
    }
}

diesel::table! {
    worker_jobs (id) {
        id -> Text,
        job_type -> Text,
        payload -> Text,
        status -> Text,
        error_message -> Nullable<Text>,
        worker_id -> Nullable<Text>,
        timeout_secs -> Integer,
        started_at -> Nullable<Timestamp>,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    worker_registrations (id) {
        id -> Text,
        callback_url -> Text,
        registered_at -> Timestamp,
        last_seen_at -> Timestamp,
    }
}

diesel::table! {
    doc_suggestions (id) {
        id -> Text,
        file_id -> Text,
        user_id -> Text,
        user_name -> Text,
        content_json -> Text,
        status -> Text,
        created_at -> Timestamp,
        resolved_at -> Nullable<Timestamp>,
        resolved_by -> Nullable<Text>,
    }
}

diesel::table! {
    comments (id) {
        id -> Text,
        file_id -> Text,
        user_id -> Text,
        user_name -> Text,
        anchor_json -> Nullable<Text>,
        body -> Text,
        status -> Text,
        assignee_id -> Nullable<Text>,
        created_at -> Timestamp,
        updated_at -> Timestamp,
        resolved_at -> Nullable<Timestamp>,
        resolved_by -> Nullable<Text>,
    }
}

diesel::table! {
    comment_replies (id) {
        id -> Text,
        comment_id -> Text,
        user_id -> Text,
        user_name -> Text,
        body -> Text,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    notifications (id) {
        id -> Text,
        recipient_id -> Text,
        event_type -> Text,
        payload -> Text,
        is_read -> Integer,
        email_sent -> Integer,
        created_at -> Timestamp,
    }
}

diesel::table! {
    file_activity_log (id) {
        id -> Text,
        file_id -> Text,
        user_id -> Text,
        user_name -> Text,
        action -> Text,
        detail_json -> Nullable<Text>,
        created_at -> Timestamp,
        // Added in migration 029
        resource_type -> Text,
        ip_address -> Nullable<Text>,
        user_agent -> Nullable<Text>,
    }
}

diesel::table! {
    file_content_index (file_id) {
        file_id -> Text,
        user_id -> Text,
        indexed_at -> Timestamp,
        text_content -> Text,
    }
}

diesel::table! {
    file_access_scores (file_id) {
        file_id -> Text,
        user_id -> Text,
        score -> Double,
        computed_at -> Timestamp,
    }
}

diesel::table! {
    file_summaries (file_id) {
        file_id -> Text,
        summary -> Text,
        generated_at -> Timestamp,
    }
}

diesel::table! {
    file_classifications (file_id) {
        file_id -> Text,
        labels -> Text,
        classified_at -> Timestamp,
    }
}

diesel::table! {
    shared_drives (id) {
        id -> Text,
        name -> Text,
        description -> Nullable<Text>,
        created_by -> Text,
        storage_used_bytes -> BigInt,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    shared_drive_members (id) {
        id -> Text,
        shared_drive_id -> Text,
        user_id -> Text,
        user_email -> Text,
        user_name -> Text,
        role -> Text,
        added_by -> Text,
        created_at -> Timestamp,
    }
}

diesel::table! {
    dlp_rules (id) {
        id -> Text,
        name -> Text,
        description -> Nullable<Text>,
        pattern -> Text,
        pattern_type -> Text,
        action -> Text,
        severity -> Text,
        is_active -> Integer,
        created_by -> Text,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    dlp_violations (id) {
        id -> Text,
        file_id -> Text,
        rule_id -> Text,
        matched_at -> Timestamp,
        notified_at -> Nullable<Timestamp>,
        action_taken -> Nullable<Text>,
        dismissed_at -> Nullable<Timestamp>,
        dismissed_by -> Nullable<Text>,
    }
}

diesel::table! {
    legal_holds (id) {
        id -> Text,
        name -> Text,
        description -> Nullable<Text>,
        created_by -> Text,
        custodian_ids -> Text,
        is_active -> Integer,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    retention_policies (id) {
        id -> Text,
        name -> Text,
        retain_for_days -> Integer,
        applies_to_mime_type -> Nullable<Text>,
        applies_to_user_id -> Nullable<Text>,
        is_active -> Integer,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    file_legal_holds (file_id, hold_id) {
        file_id -> Text,
        hold_id -> Text,
        applied_at -> Timestamp,
    }
}

diesel::table! {
    ransomware_events (id) {
        id -> Text,
        user_id -> Text,
        triggered_at -> Timestamp,
        event_count -> Integer,
        status -> Text,
        reviewed_by -> Nullable<Text>,
        reviewed_at -> Nullable<Timestamp>,
    }
}

diesel::table! {
    siem_configs (id) {
        id -> Text,
        endpoint_url -> Text,
        api_key -> Text,
        format -> Text,
        is_active -> Integer,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}

diesel::table! {
    tags (id) {
        id -> Text,
        user_id -> Text,
        name -> Text,
        created_at -> Timestamp,
    }
}

diesel::table! {
    file_tags (file_id, tag_id) {
        file_id -> Text,
        tag_id -> Text,
    }
}

// ── Added in migration 036 ────────────────────────────────────────────────────

diesel::table! {
    file_key_refs (id) {
        id -> Text,
        file_id -> Text,
        user_id -> Text,
        // Base64url-encoded sealed-box ciphertext of the DEK.
        encrypted_file_key -> Text,
        created_at -> Timestamp,
    }
}

// ── Added in migration 038 ────────────────────────────────────────────────────

diesel::table! {
    service_registrations (name) {
        name -> Text,
        endpoint -> Text,
        version -> Text,
        health_check_url -> Text,
        registered_at -> Timestamp,
        enabled -> Integer,
        auto_update -> Integer,
    }
}

// ── Joinable relationships ────────────────────────────────────────────────────

// Auth
diesel::joinable!(refresh_tokens -> users (user_id));
diesel::joinable!(totp_backup_codes -> users (user_id));
diesel::joinable!(user_profiles -> users (user_id));

// Calendar
diesel::joinable!(task_list_memberships -> tasks (task_id));
diesel::joinable!(task_list_memberships -> task_lists (list_id));

// Sheets
diesel::joinable!(named_ranges -> sheets (sheet_db_id));

// Photos
diesel::joinable!(faces -> photos (photo_id));
diesel::joinable!(face_suggestions -> faces (face_id));

// Drive
diesel::joinable!(files -> folders (folder_id));
diesel::joinable!(shortcuts -> files (target_file_id));
diesel::joinable!(file_versions -> files (file_id));
diesel::joinable!(shared_drive_members -> shared_drives (shared_drive_id));
diesel::joinable!(dlp_violations -> dlp_rules (rule_id));
diesel::joinable!(file_legal_holds -> legal_holds (hold_id));
diesel::joinable!(file_tags -> files (file_id));
diesel::joinable!(file_tags -> tags (tag_id));

// ── Cross-table query allowlist ───────────────────────────────────────────────

diesel::allow_tables_to_appear_in_same_query!(
    // Auth
    users,
    refresh_tokens,
    totp_backup_codes,
    user_profiles,
    // Calendar
    events,
    reminders,
    event_attachments,
    event_attendees,
    calendar_connections,
    task_lists,
    tasks,
    task_list_memberships,
    // Docs
    docs,
    doc_yjs_state,
    doc_templates,
    // Notes
    notes,
    note_links,
    // Photos
    photos,
    photo_edits,
    locked_folder_settings,
    albums,
    album_photos,
    faces,
    face_suggestions,
    training_signals,
    user_recognition_thresholds,
    persons,
    // Sheets
    sheets,
    named_ranges,
    // Slides
    slides,
    slide_themes,
    // Drive
    folders,
    files,
    user_quotas,
    shortcuts,
    file_versions,
    share_links,
    permissions,
    access_requests,
    irm_policies,
    workspace_settings,
    worker_jobs,
    worker_registrations,
    doc_suggestions,
    comments,
    comment_replies,
    notifications,
    file_activity_log,
    file_content_index,
    file_access_scores,
    file_summaries,
    file_classifications,
    shared_drives,
    shared_drive_members,
    dlp_rules,
    dlp_violations,
    legal_holds,
    retention_policies,
    file_legal_holds,
    ransomware_events,
    siem_configs,
    tags,
    file_tags,
    file_key_refs,
);
