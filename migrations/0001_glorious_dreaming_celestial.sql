PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_sync_state`("key", "value") SELECT "key", cast("updated_at" as text) FROM `sync_state`;--> statement-breakpoint
DROP TABLE `sync_state`;--> statement-breakpoint
ALTER TABLE `__new_sync_state` RENAME TO `sync_state`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
