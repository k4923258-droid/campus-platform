ALTER TABLE registration_member ADD CONSTRAINT fk_member_user
 FOREIGN KEY (user_id) REFERENCES campus_users(id) ON DELETE CASCADE;
