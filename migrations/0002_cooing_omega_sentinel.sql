CREATE TABLE `pricing_record` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_vendor` text NOT NULL,
	`canonical_model` text NOT NULL,
	`vendor_model_id` text NOT NULL,
	`currency` text NOT NULL,
	`input_price` real NOT NULL,
	`output_price` real NOT NULL,
	`reasoning_price` real NOT NULL,
	`cache_read_price` real NOT NULL,
	`cache_write_price` real NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text NOT NULL,
	`confidence` text NOT NULL,
	`is_manual_override` integer NOT NULL,
	`effective_time` integer NOT NULL,
	`observed_time` integer,
	`superseded_time` integer,
	`enabled` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pricing_source_event` (
	`id` text PRIMARY KEY NOT NULL,
	`pricing_record_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text NOT NULL,
	`observed_time` integer NOT NULL,
	`payload_json` text
);
