/**
 * Ordered schema migrations. `PRAGMA user_version` stores the applied version.
 * Never edit a released migration; append a new one instead.
 */

export interface Migration {
	version: number;
	name: string;
	sql: string;
}

export const migrations: Migration[] = [
	{
		version: 1,
		name: 'initial schema',
		sql: `
CREATE TABLE lists (
	id          TEXT PRIMARY KEY,
	name        TEXT NOT NULL,
	position    INTEGER NOT NULL DEFAULT 0,
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL
);

CREATE TABLE categories (
	id          TEXT PRIMARY KEY,
	name        TEXT NOT NULL,
	position    INTEGER NOT NULL DEFAULT 0,
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL
);

-- A product is a unique (case/whitespace-insensitive) name shared by all lists.
CREATE TABLE products (
	id          TEXT PRIMARY KEY,
	name        TEXT NOT NULL,
	name_key    TEXT NOT NULL UNIQUE,
	category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
	favorite    INTEGER NOT NULL DEFAULT 0,
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL,
	version     INTEGER NOT NULL DEFAULT 1
);

-- One activation/purchase cycle: activated_at -> completed_at (purchase) or cancelled_at.
CREATE TABLE cycles (
	id           TEXT PRIMARY KEY,
	product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
	list_id      TEXT REFERENCES lists(id) ON DELETE SET NULL,
	activated_at INTEGER NOT NULL,
	completed_at INTEGER,
	cancelled_at INTEGER,
	quantity     REAL,
	unit         TEXT
);
CREATE INDEX cycles_product_completed ON cycles(product_id, completed_at);
CREATE INDEX cycles_completed ON cycles(completed_at);

-- A product placed on a list. At most one row per (list, product): duplicates are impossible.
CREATE TABLE items (
	id           TEXT PRIMARY KEY,
	list_id      TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
	product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
	quantity     REAL,
	unit         TEXT,
	status       TEXT NOT NULL CHECK (status IN ('active', 'completed')),
	activated_at INTEGER NOT NULL,
	completed_at INTEGER,
	cycle_id     TEXT REFERENCES cycles(id) ON DELETE SET NULL,
	created_at   INTEGER NOT NULL,
	updated_at   INTEGER NOT NULL,
	version      INTEGER NOT NULL DEFAULT 1,
	UNIQUE (list_id, product_id)
);
CREATE INDEX items_list ON items(list_id, status);

-- Every applied operation, for idempotency and server-side undo.
CREATE TABLE ops (
	id          TEXT PRIMARY KEY,
	type        TEXT NOT NULL,
	client_id   TEXT NOT NULL,
	received_at INTEGER NOT NULL,
	status      TEXT NOT NULL,
	result      TEXT NOT NULL,
	inverse     TEXT,
	undone_at   INTEGER
);
CREATE INDEX ops_received ON ops(received_at);

-- Client-generated ids that were merged into an existing entity (duplicate adds).
CREATE TABLE id_aliases (
	alias      TEXT PRIMARY KEY,
	target     TEXT NOT NULL,
	kind       TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE TABLE meta (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
INSERT INTO meta (key, value) VALUES ('seq', '0');
`
	},
	{
		version: 2,
		name: 'default list and categories',
		sql: `
INSERT INTO lists (id, name, position, created_at, updated_at)
VALUES ('default', 'Boodschappen', 0, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);

INSERT INTO categories (id, name, position, created_at, updated_at) VALUES
	('cat-groente', 'Groente & fruit', 0, 0, 0),
	('cat-brood', 'Brood & bakkerij', 1, 0, 0),
	('cat-zuivel', 'Zuivel & eieren', 2, 0, 0),
	('cat-kaas', 'Kaas & vleeswaren', 3, 0, 0),
	('cat-vlees', 'Vlees, vis & vega', 4, 0, 0),
	('cat-houdbaar', 'Houdbaar', 5, 0, 0),
	('cat-diepvries', 'Diepvries', 6, 0, 0),
	('cat-dranken', 'Dranken', 7, 0, 0),
	('cat-snacks', 'Snacks & snoep', 8, 0, 0),
	('cat-verzorging', 'Verzorging', 9, 0, 0),
	('cat-huishouden', 'Huishouden', 10, 0, 0);
`
	},
	{
		version: 3,
		name: 'ai recommendations and data epoch',
		sql: `
-- Recommendations imported from external AI tools. Kept separate from local predictions and
-- from purchase history: accepting one only adds the product to a list.
CREATE TABLE ai_recommendations (
	id                 TEXT PRIMARY KEY,
	product_id         TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
	suggested_quantity REAL,
	suggested_unit     TEXT,
	next_purchase_at   INTEGER,
	confidence         REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
	reasoning          TEXT NOT NULL,
	source             TEXT,
	batch_id           TEXT NOT NULL,
	fingerprint        TEXT NOT NULL UNIQUE,
	status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
	imported_at        INTEGER NOT NULL,
	resolved_at        INTEGER,
	version            INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ai_recommendations_status ON ai_recommendations(status, product_id);

-- Changes whenever the whole dataset is replaced (restore/import), so devices can reconcile.
INSERT OR IGNORE INTO meta (key, value) VALUES ('epoch', lower(hex(randomblob(8))));
`
	},
	{
		version: 4,
		name: 'shopping mode, quantities, product memory, bundles, checklists and stock',
		sql: `
-- Lists: grocery list (default) or checklist; optional per-list category walking route.
ALTER TABLE lists ADD COLUMN kind TEXT NOT NULL DEFAULT 'grocery' CHECK (kind IN ('grocery', 'checklist'));
ALTER TABLE lists ADD COLUMN kind_changed_at INTEGER;
ALTER TABLE lists ADD COLUMN category_order TEXT;

-- Uploaded photos. Files live in DATA_DIR/media/<id>.<ext>; only the id travels in snapshots.
CREATE TABLE media (
	id         TEXT PRIMARY KEY,
	mime       TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
	width      INTEGER NOT NULL,
	height     INTEGER NOT NULL,
	bytes      INTEGER NOT NULL,
	sha256     TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

-- Product memory: usual quantity, preferred list, fixed note, photo and light stock status.
ALTER TABLE products ADD COLUMN default_quantity REAL;
ALTER TABLE products ADD COLUMN default_unit TEXT;
ALTER TABLE products ADD COLUMN preferred_list_id TEXT REFERENCES lists(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN note TEXT;
ALTER TABLE products ADD COLUMN photo_id TEXT REFERENCES media(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN stock_status TEXT NOT NULL DEFAULT 'unknown' CHECK (stock_status IN ('unknown', 'enough', 'low', 'out'));
ALTER TABLE products ADD COLUMN stock_updated_at INTEGER;

-- Manually managed search aliases ("toiletpapier" -> product "Wc-papier").
CREATE TABLE product_aliases (
	id         TEXT PRIMARY KEY,
	product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
	alias      TEXT NOT NULL,
	alias_key  TEXT NOT NULL UNIQUE,
	created_at INTEGER NOT NULL
);
CREATE INDEX product_aliases_product ON product_aliases(product_id);

-- Items: note for this purchase, substitute allowed, unavailable in this round, manual order.
ALTER TABLE items ADD COLUMN note TEXT;
ALTER TABLE items ADD COLUMN substitute_ok INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN substitute_note TEXT;
ALTER TABLE items ADD COLUMN unavailable_at INTEGER;
ALTER TABLE items ADD COLUMN position REAL NOT NULL DEFAULT 0;
-- Bumped whenever the quantity is set to an absolute value (not by +extra or partial purchases),
-- so undoing an increment never overrides somebody else's later absolute change.
ALTER TABLE items ADD COLUMN quantity_rev INTEGER NOT NULL DEFAULT 0;

-- Cycles: what was asked for and what was actually bought (partial purchases).
ALTER TABLE cycles ADD COLUMN requested_quantity REAL;
ALTER TABLE cycles ADD COLUMN purchased_quantity REAL;
ALTER TABLE cycles ADD COLUMN last_purchase_at INTEGER;
UPDATE cycles SET requested_quantity = quantity;
UPDATE cycles SET purchased_quantity = quantity WHERE completed_at IS NOT NULL;
UPDATE items SET position = activated_at;

-- Shared "Niet nu" for suggestions, with an end time.
CREATE TABLE snoozes (
	id         TEXT PRIMARY KEY,
	product_id TEXT NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
	until      INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

-- Bundles / reusable templates.
CREATE TABLE bundles (
	id         TEXT PRIMARY KEY,
	name       TEXT NOT NULL,
	servings   REAL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	version    INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE bundle_lines (
	id         TEXT PRIMARY KEY,
	bundle_id  TEXT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
	product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
	quantity   REAL,
	unit       TEXT,
	note       TEXT,
	position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX bundle_lines_bundle ON bundle_lines(bundle_id, position);

-- Shared shopping rounds (temporary: never exported or restored).
CREATE TABLE rounds (
	id          TEXT PRIMARY KEY,
	list_id     TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
	started_at  INTEGER NOT NULL,
	started_by  TEXT,
	ended_at    INTEGER,
	ended_by    TEXT,
	end_reason  TEXT
);
-- At most one active round per list, even when two devices start at the same moment.
CREATE UNIQUE INDEX rounds_one_active ON rounds(list_id) WHERE ended_at IS NULL;
CREATE TABLE round_participants (
	round_id     TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
	device_id    TEXT NOT NULL,
	device_name  TEXT,
	joined_at    INTEGER NOT NULL,
	last_seen_at INTEGER NOT NULL,
	left_at      INTEGER,
	PRIMARY KEY (round_id, device_id)
);
CREATE TABLE claims (
	item_id     TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
	round_id    TEXT REFERENCES rounds(id) ON DELETE CASCADE,
	device_id   TEXT NOT NULL,
	device_name TEXT,
	claimed_at  INTEGER NOT NULL,
	expires_at  INTEGER NOT NULL
);
`
	}
];
