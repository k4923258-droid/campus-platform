CREATE TABLE account_identity (
 user_id VARCHAR(64) NOT NULL PRIMARY KEY,
 email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
 student_no VARCHAR(20) NULL,
 provider VARCHAR(32) NULL,
 provider_subject VARCHAR(200) NULL,
 UNIQUE KEY uq_identity_email(email),
 UNIQUE KEY uq_identity_student(student_no),
 UNIQUE KEY uq_identity_provider(provider,provider_subject),
 CONSTRAINT fk_identity_user FOREIGN KEY(user_id) REFERENCES campus_users(id) ON DELETE CASCADE
);
ALTER TABLE registration_member ADD COLUMN user_id VARCHAR(64) NULL;
CREATE UNIQUE INDEX uq_member_user ON registration_member(activity_id,user_id);
CREATE TABLE email_challenge (
 id VARCHAR(64) NOT NULL PRIMARY KEY,
 email VARCHAR(254) NOT NULL,
 purpose VARCHAR(32) NOT NULL,
 digest VARCHAR(64) NOT NULL,
 expires_at BIGINT NOT NULL,
 created_at BIGINT NOT NULL,
 attempts INT NOT NULL DEFAULT 0,
 used BOOLEAN NOT NULL DEFAULT FALSE,
 delivery_status VARCHAR(20) NOT NULL,
 INDEX idx_challenge_email(email,created_at)
);
CREATE TABLE security_rate (
 rate_key VARCHAR(128) NOT NULL PRIMARY KEY,
 window_start BIGINT NOT NULL,
 hits INT NOT NULL
);
CREATE TABLE identity_conflict (
 id VARCHAR(64) NOT NULL PRIMARY KEY,
 claimant_id VARCHAR(64) NOT NULL,
 existing_id VARCHAR(64) NOT NULL,
 student_no VARCHAR(20) NOT NULL,
 status VARCHAR(20) NOT NULL,
 created_at BIGINT NOT NULL,
 reason VARCHAR(2000) NOT NULL DEFAULT ''
);
