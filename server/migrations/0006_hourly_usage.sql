-- Preserve compact viewing-time summaries after individual delivery samples expire.
-- Buckets follow the sample timestamp in Asia/Shanghai (the same day as daily_usage).
CREATE TABLE hourly_usage (
 device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 day TEXT NOT NULL, hour INTEGER NOT NULL CHECK(hour BETWEEN 0 AND 23),
 app_package TEXT NOT NULL, seconds INTEGER NOT NULL,
 PRIMARY KEY(device_id,day,hour,app_package)
) STRICT;
INSERT INTO hourly_usage
 SELECT device_id,day,CAST(strftime('%H',at_ms/1000,'unixepoch','+8 hours') AS INTEGER),app_package,SUM(seconds)
 FROM usage_samples GROUP BY device_id,day,3,app_package;
CREATE TRIGGER aggregate_hourly_sample AFTER INSERT ON usage_samples BEGIN
 INSERT INTO hourly_usage VALUES(NEW.device_id,NEW.day,
 CAST(strftime('%H',NEW.at_ms/1000,'unixepoch','+8 hours') AS INTEGER),NEW.app_package,NEW.seconds)
 ON CONFLICT(device_id,day,hour,app_package) DO UPDATE SET seconds=seconds+excluded.seconds;
END;
