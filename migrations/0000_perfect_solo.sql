CREATE TABLE `message_usage_fact` (
	`message_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`project_id` text NOT NULL,
	`parent_message_id` text,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`time_created` integer NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`reasoning_tokens` integer NOT NULL,
	`cache_read_tokens` integer NOT NULL,
	`cache_write_tokens` integer NOT NULL,
	`total_tokens` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_tree_edge` (
	`session_id` text PRIMARY KEY NOT NULL,
	`parent_session_id` text,
	`project_id` text NOT NULL,
	`directory` text NOT NULL,
	`title` text NOT NULL,
	`time_created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL
);
