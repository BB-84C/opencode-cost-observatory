PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pricing_record` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_vendor` text NOT NULL,
	`canonical_model` text NOT NULL,
	`vendor_model_id` text NOT NULL,
	`currency` text NOT NULL,
	`input_price` real NOT NULL,
	`output_price` real NOT NULL,
	`reasoning_price` real NOT NULL,
	`reasoning_billing_rule_json` text NOT NULL,
	`cache_read_price` real NOT NULL,
	`cache_write_price` real NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text NOT NULL,
	`confidence` text NOT NULL,
	`is_manual_override` integer NOT NULL,
	`effective_time` integer NOT NULL,
	`observed_time` integer,
	`superseded_time` integer,
	`enabled` integer NOT NULL,
	CONSTRAINT "pricing_record_currency_usd" CHECK("__new_pricing_record"."currency" = 'USD'),
	CONSTRAINT "pricing_record_source_type_valid" CHECK(("__new_pricing_record"."source_type" = 'manual' or "__new_pricing_record"."source_type" = 'official' or "__new_pricing_record"."source_type" = 'openrouter' or "__new_pricing_record"."source_type" = 'websearch')),
	CONSTRAINT "pricing_record_source_url_non_blank" CHECK(length(trim("__new_pricing_record"."source_url")) > 0),
	CONSTRAINT "pricing_record_manual_override_coherent" CHECK(("__new_pricing_record"."source_type" = 'manual' and "__new_pricing_record"."is_manual_override" = 1) or ("__new_pricing_record"."source_type" <> 'manual' and "__new_pricing_record"."is_manual_override" = 0))
);
--> statement-breakpoint
INSERT INTO `__new_pricing_record`("id", "canonical_vendor", "canonical_model", "vendor_model_id", "currency", "input_price", "output_price", "reasoning_price", "reasoning_billing_rule_json", "cache_read_price", "cache_write_price", "source_type", "source_url", "confidence", "is_manual_override", "effective_time", "observed_time", "superseded_time", "enabled") SELECT "id", "canonical_vendor", "canonical_model", "vendor_model_id", "currency", "input_price", "output_price", "reasoning_price", case
	when "reasoning_billing_rule_json" is null
		or trim("reasoning_billing_rule_json") = ''
		or json_valid("reasoning_billing_rule_json") = 0
		or lower(trim(coalesce(json_extract("reasoning_billing_rule_json", '$.provenance.sourceType'), ''))) not in ('manual', 'official', 'openrouter', 'websearch')
		or trim(coalesce(json_extract("reasoning_billing_rule_json", '$.provenance.sourceUrl'), '')) = '' then json_object(
			'kind', 'per_token',
			'provenance', json_object(
				'sourceType', case
					when lower(trim("source_type")) in ('manual', 'official', 'openrouter', 'websearch') then lower(trim("source_type"))
					else 'manual'
				end,
				'sourceUrl', coalesce(nullif(trim("source_url"), ''), 'runtime-bootstrap')
			)
		)
	else "reasoning_billing_rule_json"
end, "cache_read_price", "cache_write_price", case
	when lower(trim("source_type")) in ('manual', 'official', 'openrouter', 'websearch') then lower(trim("source_type"))
	else 'manual'
end, coalesce(nullif(trim("source_url"), ''), 'runtime-bootstrap'), "confidence", case
	when case
		when lower(trim("source_type")) in ('manual', 'official', 'openrouter', 'websearch') then lower(trim("source_type"))
		else 'manual'
	end = 'manual' then 1
	else 0
end, "effective_time", "observed_time", "superseded_time", "enabled" FROM `pricing_record`;--> statement-breakpoint
DROP TABLE `pricing_record`;--> statement-breakpoint
ALTER TABLE `__new_pricing_record` RENAME TO `pricing_record`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
