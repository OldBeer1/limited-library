-- Limited Library L0 schema draft. Not a production migration.
-- SQLite >= 3.37 (STRICT); application must enable FK on every connection.
-- This script is a fresh-schema snapshot. Do not run against a real user DB.
PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE categories (
    id TEXT PRIMARY KEY NOT NULL
        CHECK (id IN ('tv', 'movie', 'anime', 'documentary', 'theatre', 'comic')),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    capacity INTEGER NOT NULL CHECK (capacity >= 0),
    sort_order INTEGER NOT NULL UNIQUE CHECK (sort_order BETWEEN 1 AND 6),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
) STRICT;

CREATE TABLE assets (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    filename TEXT NOT NULL UNIQUE
        CHECK (length(trim(filename)) > 0
            AND instr(filename, '/') = 0 AND instr(filename, char(92)) = 0
            AND instr(filename, ':') = 0 AND instr(filename, '..') = 0),
    mime TEXT NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
    size INTEGER NOT NULL CHECK (size BETWEEN 1 AND 5242880),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        CHECK (created_at GLOB '????-??-??T??:??:??.???Z')
) STRICT;

CREATE TABLE media_items (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0 AND title = trim(title)),
    original_title TEXT
        CHECK (original_title IS NULL
            OR (length(trim(original_title)) > 0 AND original_title = trim(original_title))),
    category_id TEXT NOT NULL REFERENCES categories(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    cover_asset_id TEXT REFERENCES assets(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('planned', 'watching', 'completed', 'dropped', 'archived')),
    rating REAL CHECK (rating IS NULL
        OR (rating BETWEEN 0 AND 10 AND rating * 2 = CAST(rating * 2 AS INTEGER))),
    date_added TEXT NOT NULL
        CHECK (date_added GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
            AND substr(date_added, 1, 4) BETWEEN '0001' AND '9999'
            AND date(date_added, '+0 days') IS NOT NULL
            AND date(date_added, '+0 days') = date_added),
    date_completed TEXT
        CHECK (date_completed IS NULL
            OR (date_completed GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                AND substr(date_completed, 1, 4) BETWEEN '0001' AND '9999'
                AND date(date_completed, '+0 days') IS NOT NULL
                AND date(date_completed, '+0 days') = date_completed)),
    notes TEXT NOT NULL DEFAULT '',
    favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    has_completed INTEGER NOT NULL DEFAULT 0 CHECK (has_completed IN (0, 1)),
    archived_from_status TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    CHECK ((status = 'archived' AND archived_from_status IS NOT NULL
            AND archived_from_status IN ('planned', 'watching', 'completed', 'dropped'))
        OR (status <> 'archived' AND archived_from_status IS NULL)),
    CHECK (status <> 'completed' OR has_completed = 1),
    CHECK (archived_from_status IS NULL OR archived_from_status <> 'completed' OR has_completed = 1),
    CHECK (date_completed IS NULL OR has_completed = 1)
) STRICT;

CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    checksum TEXT NOT NULL
        CHECK (length(checksum) = 64 AND checksum NOT GLOB '*[^0-9a-f]*'),
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        CHECK (applied_at GLOB '????-??-??T??:??:??.???Z')
) STRICT;

CREATE TABLE mutation_requests (
    request_id TEXT PRIMARY KEY NOT NULL CHECK (length(request_id) > 0),
    operation TEXT NOT NULL
        CHECK (operation IN ('item.create', 'item.update', 'item.delete', 'replacement', 'category.update')),
    payload_hash TEXT NOT NULL
        CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
    result_json TEXT NOT NULL CHECK (json_valid(result_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        CHECK (created_at GLOB '????-??-??T??:??:??.???Z')
) STRICT;

CREATE INDEX idx_items_category_status ON media_items(category_id, status);
CREATE INDEX idx_items_cover ON media_items(cover_asset_id);
CREATE INDEX idx_items_history
    ON media_items(category_id, date_completed DESC, created_at DESC, id)
    WHERE has_completed = 1;
CREATE INDEX idx_items_archive
    ON media_items(category_id, updated_at DESC, id)
    WHERE status = 'archived';

CREATE VIEW v_category_summary AS
SELECT c.id AS category_id, c.name, c.capacity,
       count(i.id) AS retained, c.capacity - count(i.id) AS remaining
FROM categories AS c
LEFT JOIN media_items AS i ON i.category_id = c.id AND i.status <> 'archived'
GROUP BY c.id, c.name, c.capacity;

CREATE VIEW v_completed_items AS
SELECT * FROM media_items WHERE has_completed = 1;

-- Guards only reject writes. ABORT does NOT roll back earlier statements
-- in the transaction; service code must explicitly ROLLBACK the whole unit.
CREATE TRIGGER items_capacity_insert
BEFORE INSERT ON media_items
WHEN NEW.status <> 'archived'
    AND (SELECT count(*) FROM media_items
         WHERE category_id = NEW.category_id AND status <> 'archived')
        >= (SELECT capacity FROM categories WHERE id = NEW.category_id)
BEGIN
    SELECT RAISE(ABORT, 'CATEGORY_FULL');
END;

CREATE TRIGGER items_capacity_update
BEFORE UPDATE OF category_id, status ON media_items
WHEN NEW.status <> 'archived'
    AND (SELECT count(*) FROM media_items
         WHERE category_id = NEW.category_id AND status <> 'archived' AND id <> OLD.id)
        >= (SELECT capacity FROM categories WHERE id = NEW.category_id)
BEGIN
    SELECT RAISE(ABORT, 'CATEGORY_FULL');
END;

CREATE TRIGGER categories_capacity_update
BEFORE UPDATE OF capacity ON categories
WHEN NEW.capacity < (SELECT count(*) FROM media_items
                     WHERE category_id = OLD.id AND status <> 'archived')
BEGIN
    SELECT RAISE(ABORT, 'CAPACITY_TOO_SMALL');
END;

CREATE TRIGGER categories_id_immutable
BEFORE UPDATE OF id ON categories WHEN NEW.id <> OLD.id
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABLE_ID');
END;

CREATE TRIGGER categories_no_delete
BEFORE DELETE ON categories
BEGIN
    SELECT RAISE(ABORT, 'FIXED_CATEGORY');
END;

CREATE TRIGGER items_id_immutable
BEFORE UPDATE OF id ON media_items WHEN NEW.id <> OLD.id
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABLE_ID');
END;

INSERT INTO categories(id, name, capacity, sort_order) VALUES
    ('tv', '电视剧', 10, 1),
    ('movie', '电影', 10, 2),
    ('anime', '动漫', 10, 3),
    ('documentary', '纪录片', 6, 4),
    ('theatre', '话剧', 10, 5),
    ('comic', '漫画', 5, 6);

COMMIT;
