CREATE TABLE classes (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 60)
);
ALTER TABLE codes ADD COLUMN class_id integer REFERENCES classes(id);
-- Codes generated before classes existed are kept under a "General" class.
INSERT INTO classes (name) SELECT 'General' WHERE EXISTS (SELECT 1 FROM codes);
UPDATE codes SET class_id = (SELECT id FROM classes WHERE name = 'General') WHERE class_id IS NULL;
CREATE INDEX codes_class_idx ON codes (class_id);
