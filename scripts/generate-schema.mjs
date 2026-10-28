import fs from 'node:fs'
import path from 'node:path'
const root=path.resolve(import.meta.dirname,'..')
const collections=['users','organizations','activities','applications','slots','notices','grants','audits','attachments','semesters']
const sql=collections.map(name=>`CREATE TABLE campus_${name} (id VARCHAR(64) NOT NULL PRIMARY KEY, body LONGTEXT NOT NULL);`).join('\n')+`
CREATE TABLE mutation_lock (id BIGINT NOT NULL PRIMARY KEY);
INSERT INTO mutation_lock(id) VALUES (1);
CREATE TABLE registration_member (activity_id VARCHAR(64) NOT NULL, student_no VARCHAR(20) NOT NULL, application_id VARCHAR(64) NOT NULL, PRIMARY KEY(activity_id,student_no));
CREATE INDEX idx_member_application ON registration_member(application_id);
CREATE TABLE slot_reservation (application_id VARCHAR(64) NOT NULL PRIMARY KEY, slot_id VARCHAR(64) NOT NULL);
CREATE INDEX idx_reservation_slot ON slot_reservation(slot_id);
`
fs.writeFileSync(path.join(root,'backend/src/main/resources/db/migration/V1__platform.sql'),sql)
