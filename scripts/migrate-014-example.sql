-- Phase 3, step 11: public trips, and one example.
--
-- A public trip can be read by anyone, signed in or not, at its usual
-- addresses; only its members can change it. The front page lists public
-- trips as examples. Everything else stays private.
--
-- The example is a made-up weekend in Amsterdam, written for the front page:
-- six places, votes from three placeholder people, one booking, a two-day
-- plan and an entry of their own. Coordinates were checked against
-- OpenStreetMap on 2026-09-25. Ids are prefixed "ams-" so they can never
-- collide with a real trip's. INSERT OR IGNORE throughout: re-running this
-- never overwrites a change someone has since made to the example.

ALTER TABLE trips ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';

INSERT OR IGNORE INTO trips
  (id, name, destination, start_date, end_date, base_name, base_lat, base_lon,
   near_lat, near_lon, notes, set_by, updated_at, created_at, visibility)
VALUES (2, 'A weekend in Amsterdam', 'Amsterdam', '2027-03-13', '2027-03-14',
        'Stayokay Amsterdam Vondelpark, Zandpad 5', 52.3611, 4.8780,
        52.3676, 4.9041,
        'An example trip. Look around: this is what a trip looks like once a group has voted, booked and planned. Sign in to plan your own.',
        'setup', 0, 0, 'public');

INSERT OR IGNORE INTO trip_members (id, trip_id, name, name_key, note, added_by, created_at, role) VALUES
  ('ams-m-sam',  2, 'Sam',  'sam',  NULL, 'setup', 0, 'owner'),
  ('ams-m-alex', 2, 'Alex', 'alex', 'arrives Friday night', 'setup', 0, 'editor'),
  ('ams-m-kim',  2, 'Kim',  'kim',  NULL, 'setup', 0, 'editor');

INSERT OR IGNORE INTO items
  (id, trip_id, source, rank, name, summary, area, station, cost, price_label,
   booking_required, url, address, lat, lon, added_by, added_by_key, created_at)
VALUES
  ('ams-rijksmuseum', 2, 'added', NULL, 'Rijksmuseum',
   'The Night Watch, the Vermeers, and a building worth the visit on its own. Book a slot; mornings are quietest.',
   'Museumkwartier', 'tram 2, 12', 'paid', '€22.50', 1,
   'https://www.rijksmuseum.nl/en', 'Museumstraat 1, Amsterdam', 52.3598, 4.8850, 'Sam', 'sam', 0),
  ('ams-anne-frank', 2, 'added', NULL, 'Anne Frank House',
   'The secret annex itself. Tickets are released six weeks ahead and go within hours.',
   'Jordaan', 'tram 13, 17', 'paid', '€16', 1,
   'https://www.annefrank.org/en/', 'Westermarkt 20, Amsterdam', 52.3752, 4.8841, 'Kim', 'kim', 0),
  ('ams-canal-cruise', 2, 'added', NULL, 'Canal cruise',
   'An hour on the water is the best first look at the city. Open boats leave from behind Centraal.',
   'Centrum', 'Amsterdam Centraal', 'paid', '€18', 1,
   NULL, 'Prins Hendrikkade, Amsterdam', 52.3789, 4.9006, 'Alex', 'alex', 0),
  ('ams-vondelpark', 2, 'added', NULL, 'Vondelpark',
   'The city''s park: rent a bike, or just walk it end to end and stop for a coffee at the pavilion.',
   'Oud-Zuid', 'tram 1, 2', 'free', NULL, 0,
   NULL, 'Vondelpark, Amsterdam', 52.3572, 4.8641, 'Sam', 'sam', 0),
  ('ams-albert-cuyp', 2, 'added', NULL, 'Albert Cuyp Market',
   'The big street market. Stroopwafels made in front of you; lunch from whichever stall has a queue.',
   'De Pijp', 'tram 4, 24', 'free', NULL, 0,
   'https://albertcuyp-markt.amsterdam/', 'Albert Cuypstraat, Amsterdam', 52.3552, 4.8918, 'Alex', 'alex', 0),
  ('ams-westerkerk', 2, 'added', NULL, 'Westerkerk tower',
   'Climb the tower next to the Anne Frank House for the view over the canals. Small groups, guided.',
   'Jordaan', 'tram 13, 17', 'paid', '€10', 1,
   NULL, 'Prinsengracht 279, Amsterdam', 52.3745, 4.8840, 'Kim', 'kim', 0);

INSERT OR IGNORE INTO votes (sight_id, voter_key, voter_name, created_at, trip_id) VALUES
  ('ams-rijksmuseum',  'sam',  'Sam',  0, 2), ('ams-rijksmuseum',  'alex', 'Alex', 0, 2), ('ams-rijksmuseum', 'kim', 'Kim', 0, 2),
  ('ams-anne-frank',   'kim',  'Kim',  0, 2), ('ams-anne-frank',   'sam',  'Sam',  0, 2),
  ('ams-canal-cruise', 'alex', 'Alex', 0, 2), ('ams-canal-cruise', 'sam',  'Sam',  0, 2), ('ams-canal-cruise', 'kim', 'Kim', 0, 2),
  ('ams-vondelpark',   'sam',  'Sam',  0, 2), ('ams-vondelpark',   'alex', 'Alex', 0, 2),
  ('ams-albert-cuyp',  'alex', 'Alex', 0, 2),
  ('ams-westerkerk',   'kim',  'Kim',  0, 2);

INSERT OR IGNORE INTO comments (id, sight_id, author, author_key, body, created_at, trip_id) VALUES
  ('ams-c-1', 'ams-anne-frank', 'Kim', 'kim', 'Tickets for our dates come out on 30 January, 10:00. I''ll set an alarm.', 0, 2),
  ('ams-c-2', 'ams-albert-cuyp', 'Sam', 'sam', 'Sunday works — the market is on Mon–Sat only, so let''s do it Saturday instead?', 0, 2);

INSERT OR IGNORE INTO booking_status (sight_id, status, marked_by, booked_date, booked_time, booked_end, created_at, trip_id) VALUES
  ('ams-canal-cruise', 'booked', 'Alex', '2027-03-13', '14:00', '15:00', 0, 2);

INSERT OR IGNORE INTO plan_entries (sight_id, day, start_time, end_time, added_by, created_at, trip_id) VALUES
  ('ams-rijksmuseum', '2027-03-13', '10:00', '12:00', 'Sam', 0, 2),
  ('ams-albert-cuyp', '2027-03-13', '12:30', '13:30', 'Alex', 0, 2),
  ('ams-anne-frank',  '2027-03-14', '09:30', '11:00', 'Kim', 0, 2),
  ('ams-vondelpark',  '2027-03-14', '13:00', NULL, 'Sam', 0, 2);

INSERT OR IGNORE INTO plan_notes (id, day, start_time, end_time, label, added_by, created_at, address, lat, lon, trip_id) VALUES
  ('note-ams-dinner', '2027-03-13', '19:30', NULL, 'Dinner with Noor', 'Sam', 0, NULL, NULL, NULL, 2),
  ('note-ams-train',  '2027-03-14', '17:05', NULL, 'Train home', 'Alex', 0, 'Amsterdam Centraal', 52.3789, 4.9006, 2);
