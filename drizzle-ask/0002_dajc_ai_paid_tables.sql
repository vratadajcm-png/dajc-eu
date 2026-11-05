CREATE TABLE "dajc_ask"."accounting_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"idem_key" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"pii_key_id" text,
	"pii_ciphertext" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_outbox_idem_key_unique" UNIQUE("idem_key")
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."answer_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"answer" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"subject" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."billing_checkouts" (
	"checkout_ref" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"provider_session_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."billing_customers" (
	"provider" text NOT NULL,
	"customer_ref" text NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_customers_provider_customer_ref_pk" PRIMARY KEY("provider","customer_ref")
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."consents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"version" text NOT NULL,
	"granted" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" text NOT NULL,
	"answer_level" text NOT NULL,
	"answer_fingerprint" text NOT NULL,
	"source_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"key_id" text,
	"comment_ciphertext" text,
	"shared_learning_consent" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"key_id" text NOT NULL,
	"ciphertext" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."knowledge_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" text NOT NULL,
	"topic" text NOT NULL,
	"jurisdiction" text,
	"scope" text NOT NULL,
	"organisation_id" text,
	"summary" text NOT NULL,
	"official_source_url" text NOT NULL,
	"source_quote" text NOT NULL,
	"source_checked_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"proposed_by" text NOT NULL,
	"source_checked_by" text,
	"verified_by" text,
	"approved_by" text,
	"reviewed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."memory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key_id" text NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."paid_usage" (
	"user_id" uuid NOT NULL,
	"period" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "paid_usage_user_id_period_pk" PRIMARY KEY("user_id","period")
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."payment_events" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"outcome" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_provider_event_id_pk" PRIMARY KEY("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."refund_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"payment_ref" text NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"decided_by" text,
	"refund_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "refund_requests_payment_ref_unique" UNIQUE("payment_ref")
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."reviewers" (
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviewers_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."subscriptions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"customer_ref" text NOT NULL,
	"ledger" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."user_cost" (
	"user_id" uuid NOT NULL,
	"month" text NOT NULL,
	"spent_micro" bigint DEFAULT 0 NOT NULL,
	"reserved_micro" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "user_cost_user_id_month_pk" PRIMARY KEY("user_id","month")
);
--> statement-breakpoint
ALTER TABLE "dajc_ask"."consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "dajc_ask"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dajc_ask"."feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "dajc_ask"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dajc_ask"."history" ADD CONSTRAINT "history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "dajc_ask"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dajc_ask"."memory_items" ADD CONSTRAINT "memory_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "dajc_ask"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dajc_ask"."paid_usage" ADD CONSTRAINT "paid_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "dajc_ask"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dajc_ask"."reviewers" ADD CONSTRAINT "reviewers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "dajc_ask"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dajc_ask"."user_cost" ADD CONSTRAINT "user_cost_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "dajc_ask"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounting_outbox_due_idx" ON "dajc_ask"."accounting_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "answer_cache_expires_idx" ON "dajc_ask"."answer_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "audit_log_subject_idx" ON "dajc_ask"."audit_log" USING btree ("subject","id");--> statement-breakpoint
CREATE INDEX "billing_checkouts_user_idx" ON "dajc_ask"."billing_checkouts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "billing_customers_user_idx" ON "dajc_ask"."billing_customers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "consents_user_purpose_idx" ON "dajc_ask"."consents" USING btree ("user_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "feedback_status_idx" ON "dajc_ask"."feedback" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "history_user_created_idx" ON "dajc_ask"."history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "history_expires_idx" ON "dajc_ask"."history" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "knowledge_entries_topic_idx" ON "dajc_ask"."knowledge_entries" USING btree ("topic","status");--> statement-breakpoint
CREATE INDEX "memory_items_user_idx" ON "dajc_ask"."memory_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memory_items_expires_idx" ON "dajc_ask"."memory_items" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "refund_requests_user_idx" ON "dajc_ask"."refund_requests" USING btree ("user_id");