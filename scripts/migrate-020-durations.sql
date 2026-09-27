-- Times that add up: a rough visit length per place.
--
-- The London places get the estimates the template carries (src/sights.js),
-- wherever they are — the London trip itself and every copy made from the
-- template — but only where nobody has set one by hand. Everything else
-- stays NULL: unknown, and shown as such.
--
-- substr(), not LIKE: D1 caps a LIKE pattern at 50 bytes, and the longest
-- id here is over that. (Found on the local database; it would have failed
-- live the same way.)
ALTER TABLE items ADD COLUMN duration_min INTEGER;

UPDATE items SET duration_min = 180 WHERE duration_min IS NULL AND (id = 'tower-of-london' OR substr(id, 1, 17) = 'tower-of-london-t');
UPDATE items SET duration_min = 150 WHERE duration_min IS NULL AND (id = 'british-museum' OR substr(id, 1, 16) = 'british-museum-t');
UPDATE items SET duration_min = 60 WHERE duration_min IS NULL AND (id = 'the-painted-hall-old-royal-naval-college' OR substr(id, 1, 42) = 'the-painted-hall-old-royal-naval-college-t');
UPDATE items SET duration_min = 60 WHERE duration_min IS NULL AND (id = 'sir-john-soane-s-museum' OR substr(id, 1, 25) = 'sir-john-soane-s-museum-t');
UPDATE items SET duration_min = 120 WHERE duration_min IS NULL AND (id = 'westminster-abbey-diamond-jubilee-galleries' OR substr(id, 1, 45) = 'westminster-abbey-diamond-jubilee-galleries-t');
UPDATE items SET duration_min = 120 WHERE duration_min IS NULL AND (id = 'st-paul-s-cathedral-the-dome-climb' OR substr(id, 1, 36) = 'st-paul-s-cathedral-the-dome-climb-t');
UPDATE items SET duration_min = 120 WHERE duration_min IS NULL AND (id = 'national-gallery' OR substr(id, 1, 18) = 'national-gallery-t');
UPDATE items SET duration_min = 45 WHERE duration_min IS NULL AND (id = 'horizon-22' OR substr(id, 1, 12) = 'horizon-22-t');
UPDATE items SET duration_min = 45 WHERE duration_min IS NULL AND (id = 'leadenhall-market-the-lloyd-s-building' OR substr(id, 1, 40) = 'leadenhall-market-the-lloyd-s-building-t');
UPDATE items SET duration_min = 150 WHERE duration_min IS NULL AND (id = 'victoria-and-albert-museum' OR substr(id, 1, 28) = 'victoria-and-albert-museum-t');
UPDATE items SET duration_min = 240 WHERE duration_min IS NULL AND (id = 'warner-bros-studio-tour-the-making-of-harry-potter' OR substr(id, 1, 52) = 'warner-bros-studio-tour-the-making-of-harry-potter-t');
UPDATE items SET duration_min = 120 WHERE duration_min IS NULL AND (id = 'borough-market-the-south-bank-walk' OR substr(id, 1, 36) = 'borough-market-the-south-bank-walk-t');
UPDATE items SET duration_min = 30 WHERE duration_min IS NULL AND (id = 'big-ben-westminster-bridge' OR substr(id, 1, 28) = 'big-ben-westminster-bridge-t');
UPDATE items SET duration_min = 120 WHERE duration_min IS NULL AND (id = 'tate-modern' OR substr(id, 1, 13) = 'tate-modern-t');
UPDATE items SET duration_min = 120 WHERE duration_min IS NULL AND (id = 'eltham-palace' OR substr(id, 1, 15) = 'eltham-palace-t');
UPDATE items SET duration_min = 45 WHERE duration_min IS NULL AND (id = 'two-temple-place' OR substr(id, 1, 18) = 'two-temple-place-t');
UPDATE items SET duration_min = 180 WHERE duration_min IS NULL AND (id = 'hampstead-the-heath-and-kenwood-house' OR substr(id, 1, 39) = 'hampstead-the-heath-and-kenwood-house-t');
UPDATE items SET duration_min = 180 WHERE duration_min IS NULL AND (id = 'kew-gardens-the-palm-house' OR substr(id, 1, 28) = 'kew-gardens-the-palm-house-t');
UPDATE items SET duration_min = 60 WHERE duration_min IS NULL AND (id = 'sky-garden' OR substr(id, 1, 12) = 'sky-garden-t');
UPDATE items SET duration_min = 120 WHERE duration_min IS NULL AND (id = 'natural-history-museum-hintze-hall' OR substr(id, 1, 36) = 'natural-history-museum-hintze-hall-t');
UPDATE items SET duration_min = 90 WHERE duration_min IS NULL AND (id = 'highgate-cemetery' OR substr(id, 1, 19) = 'highgate-cemetery-t');
UPDATE items SET duration_min = 90 WHERE duration_min IS NULL AND (id = 'the-wallace-collection' OR substr(id, 1, 24) = 'the-wallace-collection-t');
UPDATE items SET duration_min = 20 WHERE duration_min IS NULL AND (id = 'st-dunstan-in-the-east' OR substr(id, 1, 24) = 'st-dunstan-in-the-east-t');
UPDATE items SET duration_min = 30 WHERE duration_min IS NULL AND (id = 'guildhall-roman-amphitheatre' OR substr(id, 1, 30) = 'guildhall-roman-amphitheatre-t');
UPDATE items SET duration_min = 60 WHERE duration_min IS NULL AND (id = 'columbia-road-flower-market' OR substr(id, 1, 29) = 'columbia-road-flower-market-t');
UPDATE items SET duration_min = 75 WHERE duration_min IS NULL AND (id = 'tower-bridge-and-the-engine-rooms' OR substr(id, 1, 35) = 'tower-bridge-and-the-engine-rooms-t');
UPDATE items SET duration_min = 210 WHERE duration_min IS NULL AND (id = 'hampton-court-palace' OR substr(id, 1, 22) = 'hampton-court-palace-t');
UPDATE items SET duration_min = 120 WHERE duration_min IS NULL AND (id = 'imperial-war-museum-london' OR substr(id, 1, 28) = 'imperial-war-museum-london-t');
UPDATE items SET duration_min = 45 WHERE duration_min IS NULL AND (id = 'barbican-conservatory' OR substr(id, 1, 23) = 'barbican-conservatory-t');
UPDATE items SET duration_min = 150 WHERE duration_min IS NULL AND (id = 'buckingham-palace-state-rooms' OR substr(id, 1, 31) = 'buckingham-palace-state-rooms-t');
UPDATE items SET duration_min = 60 WHERE duration_min IS NULL AND (id = 'changing-of-the-guard' OR substr(id, 1, 23) = 'changing-of-the-guard-t');
UPDATE items SET duration_min = 20 WHERE duration_min IS NULL AND (id = 'platform-9-3-4' OR substr(id, 1, 16) = 'platform-9-3-4-t');
UPDATE items SET duration_min = 45 WHERE duration_min IS NULL AND (id = 'house-of-minalima' OR substr(id, 1, 19) = 'house-of-minalima-t');
UPDATE items SET duration_min = 15 WHERE duration_min IS NULL AND (id = 'millennium-bridge' OR substr(id, 1, 19) = 'millennium-bridge-t');
UPDATE items SET duration_min = 30 WHERE duration_min IS NULL AND (id = 'st-pancras-international' OR substr(id, 1, 26) = 'st-pancras-international-t');
UPDATE items SET duration_min = 60 WHERE duration_min IS NULL AND (id = 'rangers-house-bridgerton' OR substr(id, 1, 26) = 'rangers-house-bridgerton-t');
UPDATE items SET duration_min = 90 WHERE duration_min IS NULL AND (id = 'royal-observatory-greenwich' OR substr(id, 1, 29) = 'royal-observatory-greenwich-t');
UPDATE items SET duration_min = 90 WHERE duration_min IS NULL AND (id = 'shakespeares-globe' OR substr(id, 1, 20) = 'shakespeares-globe-t');
UPDATE items SET duration_min = 60 WHERE duration_min IS NULL AND (id = 'london-eye' OR substr(id, 1, 12) = 'london-eye-t');
UPDATE items SET duration_min = 75 WHERE duration_min IS NULL AND (id = 'view-from-the-shard' OR substr(id, 1, 21) = 'view-from-the-shard-t');
UPDATE items SET duration_min = 30 WHERE duration_min IS NULL AND (id = 'trafalgar-square' OR substr(id, 1, 18) = 'trafalgar-square-t');
UPDATE items SET duration_min = 60 WHERE duration_min IS NULL AND (id = 'covent-garden-piazza' OR substr(id, 1, 22) = 'covent-garden-piazza-t');
UPDATE items SET duration_min = 60 WHERE duration_min IS NULL AND (id = 'neal-s-yard-seven-dials-and-cecil-court' OR substr(id, 1, 41) = 'neal-s-yard-seven-dials-and-cecil-court-t');
UPDATE items SET duration_min = 20 WHERE duration_min IS NULL AND (id = 'piccadilly-circus' OR substr(id, 1, 19) = 'piccadilly-circus-t');
UPDATE items SET duration_min = 120 WHERE duration_min IS NULL AND (id = 'camden-market' OR substr(id, 1, 15) = 'camden-market-t');
UPDATE items SET duration_min = 120 WHERE duration_min IS NULL AND (id = 'notting-hill-portobello' OR substr(id, 1, 25) = 'notting-hill-portobello-t');
UPDATE items SET duration_min = 30 WHERE duration_min IS NULL AND (id = 'abbey-road-crossing' OR substr(id, 1, 21) = 'abbey-road-crossing-t');
UPDATE items SET duration_min = 150 WHERE duration_min IS NULL AND (id = 'richmond-park-in-rut-season' OR substr(id, 1, 29) = 'richmond-park-in-rut-season-t');
UPDATE items SET duration_min = 120 WHERE duration_min IS NULL AND (id = 'regent-s-canal-little-venice-to-camden' OR substr(id, 1, 40) = 'regent-s-canal-little-venice-to-camden-t');
UPDATE items SET duration_min = 75 WHERE duration_min IS NULL AND (id = 'museum-of-the-home' OR substr(id, 1, 20) = 'museum-of-the-home-t');
UPDATE items SET duration_min = 20 WHERE duration_min IS NULL AND (id = 'postman-s-park' OR substr(id, 1, 16) = 'postman-s-park-t');
UPDATE items SET duration_min = 45 WHERE duration_min IS NULL AND (id = 'royal-courts-of-justice' OR substr(id, 1, 25) = 'royal-courts-of-justice-t');
UPDATE items SET duration_min = 90 WHERE duration_min IS NULL AND (id = 'battersea-power-station' OR substr(id, 1, 25) = 'battersea-power-station-t');
UPDATE items SET duration_min = 90 WHERE duration_min IS NULL AND (id = 'hyde-park-kensington-gardens' OR substr(id, 1, 30) = 'hyde-park-kensington-gardens-t');
UPDATE items SET duration_min = 60 WHERE duration_min IS NULL AND (id = 'liberty-and-the-arcades' OR substr(id, 1, 25) = 'liberty-and-the-arcades-t');
