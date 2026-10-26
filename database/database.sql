-- =========================================================
-- CYBER COMMUNITY
-- DATABASE SCHEMA - POSTGRESQL
-- =========================================================

-- =========================================================
-- 1. EXTENSIONS
-- =========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =========================================================
-- 2. USERS
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,

    username VARCHAR(50) NOT NULL UNIQUE,

    email VARCHAR(255) NOT NULL UNIQUE,

    password_hash TEXT NOT NULL,

    country VARCHAR(100),

    role VARCHAR(20) NOT NULL DEFAULT 'USER',

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT users_role_check
        CHECK (role IN ('USER', 'MODERATOR', 'ADMIN'))
);


-- =========================================================
-- 3. PROFILES
-- =========================================================

CREATE TABLE IF NOT EXISTS profiles (
    user_id BIGINT PRIMARY KEY,

    pseudonym VARCHAR(100),

    photo_url TEXT,

    full_name VARCHAR(150),

    country VARCHAR(100),

    biography TEXT,

    skills TEXT,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT profiles_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);


-- =========================================================
-- 4. CATEGORIES
-- =========================================================

CREATE TABLE IF NOT EXISTS categories (
    id BIGSERIAL PRIMARY KEY,

    name VARCHAR(100) NOT NULL UNIQUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- =========================================================
-- 5. FORUM POSTS / DISCUSSIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS posts (
    id BIGSERIAL PRIMARY KEY,

    author_id BIGINT NOT NULL,

    category_id BIGINT,

    title VARCHAR(200) NOT NULL,

    content TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT posts_author_fk
        FOREIGN KEY (author_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT posts_category_fk
        FOREIGN KEY (category_id)
        REFERENCES categories(id)
        ON DELETE SET NULL
);


-- =========================================================
-- 6. COMMENTS
-- =========================================================

CREATE TABLE IF NOT EXISTS comments (
    id BIGSERIAL PRIMARY KEY,

    post_id BIGINT NOT NULL,

    author_id BIGINT NOT NULL,

    parent_id BIGINT,

    content TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT comments_post_fk
        FOREIGN KEY (post_id)
        REFERENCES posts(id)
        ON DELETE CASCADE,

    CONSTRAINT comments_author_fk
        FOREIGN KEY (author_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT comments_parent_fk
        FOREIGN KEY (parent_id)
        REFERENCES comments(id)
        ON DELETE CASCADE
);


-- =========================================================
-- 7. LIKES
-- =========================================================

CREATE TABLE IF NOT EXISTS post_likes (
    post_id BIGINT NOT NULL,

    user_id BIGINT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (post_id, user_id),

    CONSTRAINT post_likes_post_fk
        FOREIGN KEY (post_id)
        REFERENCES posts(id)
        ON DELETE CASCADE,

    CONSTRAINT post_likes_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);


-- =========================================================
-- 8. GROUPS
-- =========================================================

CREATE TABLE IF NOT EXISTS groups_table (
    id BIGSERIAL PRIMARY KEY,

    name VARCHAR(120) NOT NULL,

    description TEXT,

    is_private BOOLEAN NOT NULL DEFAULT TRUE,

    created_by BIGINT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT groups_creator_fk
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE CASCADE
);


-- =========================================================
-- 9. GROUP MEMBERS
-- =========================================================

CREATE TABLE IF NOT EXISTS group_members (
    group_id BIGINT NOT NULL,

    user_id BIGINT NOT NULL,

    group_role VARCHAR(20) NOT NULL DEFAULT 'MEMBER',

    joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (group_id, user_id),

    CONSTRAINT group_members_group_fk
        FOREIGN KEY (group_id)
        REFERENCES groups_table(id)
        ON DELETE CASCADE,

    CONSTRAINT group_members_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT group_members_role_check
        CHECK (group_role IN ('MEMBER', 'ADMIN'))
);


-- =========================================================
-- 10. GROUP DISCUSSIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS group_posts (
    id BIGSERIAL PRIMARY KEY,

    group_id BIGINT NOT NULL,

    author_id BIGINT NOT NULL,

    title VARCHAR(200) NOT NULL,

    content TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT group_posts_group_fk
        FOREIGN KEY (group_id)
        REFERENCES groups_table(id)
        ON DELETE CASCADE,

    CONSTRAINT group_posts_author_fk
        FOREIGN KEY (author_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);


-- =========================================================
-- 11. GROUP COMMENTS
-- =========================================================

CREATE TABLE IF NOT EXISTS group_comments (
    id BIGSERIAL PRIMARY KEY,

    group_post_id BIGINT NOT NULL,

    author_id BIGINT NOT NULL,

    parent_id BIGINT,

    content TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT group_comments_post_fk
        FOREIGN KEY (group_post_id)
        REFERENCES group_posts(id)
        ON DELETE CASCADE,

    CONSTRAINT group_comments_author_fk
        FOREIGN KEY (author_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT group_comments_parent_fk
        FOREIGN KEY (parent_id)
        REFERENCES group_comments(id)
        ON DELETE CASCADE
);


-- =========================================================
-- 12. GROUP MESSAGES
-- =========================================================

CREATE TABLE IF NOT EXISTS group_messages (
    id BIGSERIAL PRIMARY KEY,

    group_id BIGINT NOT NULL,

    sender_id BIGINT NOT NULL,

    content TEXT,

    file_url TEXT,

    file_name TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT group_messages_group_fk
        FOREIGN KEY (group_id)
        REFERENCES groups_table(id)
        ON DELETE CASCADE,

    CONSTRAINT group_messages_sender_fk
        FOREIGN KEY (sender_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT group_messages_content_check
        CHECK (
            content IS NOT NULL
            OR file_url IS NOT NULL
        )
);


-- =========================================================
-- 13. FILES
-- =========================================================

CREATE TABLE IF NOT EXISTS files (
    id BIGSERIAL PRIMARY KEY,

    uploader_id BIGINT NOT NULL,

    original_name TEXT NOT NULL,

    stored_name TEXT NOT NULL,

    mime_type VARCHAR(150) NOT NULL,

    size_bytes BIGINT NOT NULL,

    url TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT files_uploader_fk
        FOREIGN KEY (uploader_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);


-- =========================================================
-- 14. REPORTS / SIGNALEMENTS
-- =========================================================

CREATE TABLE IF NOT EXISTS reports (
    id BIGSERIAL PRIMARY KEY,

    reporter_id BIGINT NOT NULL,

    target_type VARCHAR(30) NOT NULL,

    target_id BIGINT NOT NULL,

    reason VARCHAR(100) NOT NULL,

    details TEXT,

    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',

    handled_by BIGINT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT reports_reporter_fk
        FOREIGN KEY (reporter_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT reports_handler_fk
        FOREIGN KEY (handled_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    CONSTRAINT reports_target_type_check
        CHECK (
            target_type IN (
                'USER',
                'POST',
                'COMMENT',
                'GROUP',
                'MESSAGE'
            )
        ),

    CONSTRAINT reports_status_check
        CHECK (
            status IN (
                'PENDING',
                'REVIEWED',
                'RESOLVED',
                'REJECTED'
            )
        )
);


-- =========================================================
-- 15. NOTIFICATIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL,

    type VARCHAR(50) NOT NULL,

    message TEXT NOT NULL,

    is_read BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT notifications_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);


-- =========================================================
-- 16. INDEX
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_users_username
ON users(username);

CREATE INDEX IF NOT EXISTS idx_users_email
ON users(email);

CREATE INDEX IF NOT EXISTS idx_posts_author
ON posts(author_id);

CREATE INDEX IF NOT EXISTS idx_posts_category
ON posts(category_id);

CREATE INDEX IF NOT EXISTS idx_comments_post
ON comments(post_id);

CREATE INDEX IF NOT EXISTS idx_comments_author
ON comments(author_id);

CREATE INDEX IF NOT EXISTS idx_group_members_user
ON group_members(user_id);

CREATE INDEX IF NOT EXISTS idx_group_posts_group
ON group_posts(group_id);

CREATE INDEX IF NOT EXISTS idx_group_messages_group
ON group_messages(group_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user
ON notifications(user_id);

CREATE INDEX IF NOT EXISTS idx_reports_status
ON reports(status);


-- =========================================================
-- 17. CATEGORIES PAR DEFAUT
-- =========================================================

INSERT INTO categories (name)
VALUES
    ('Cybersécurité'),
    ('Programmation'),
    ('Linux'),
    ('Réseaux'),
    ('CTF'),
    ('Actualités'),
    ('Débutants'),
    ('Autres')
ON CONFLICT (name) DO NOTHING;


-- =========================================================
-- FIN DU SCRIPT
-- =========================================================