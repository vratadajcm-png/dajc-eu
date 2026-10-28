CREATE SCHEMA "dajc_ask";
--> statement-breakpoint
CREATE TABLE "dajc_ask"."budget" (
	"period" text PRIMARY KEY NOT NULL,
	"spent_micro" bigint DEFAULT 0 NOT NULL,
	"reserved_micro" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."daily_usage" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_usage_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."login_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"email_hmac" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."metrics" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"level" text NOT NULL,
	"language" text NOT NULL,
	"path" text NOT NULL,
	"cost_micro" integer NOT NULL,
	"latency_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."rate_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bucket_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."review_queue" (
	"url" text PRIMARY KEY NOT NULL,
	"jurisdiction" text,
	"topic" text NOT NULL,
	"first_seen" date NOT NULL,
	"last_seen" date NOT NULL,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dajc_ask"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_hmac" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_hmac_unique" UNIQUE("email_hmac")
);
--> statement-breakpoint
ALTER TABLE "dajc_ask"."daily_usage" ADD CONSTRAINT "daily_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "dajc_ask"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dajc_ask"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "dajc_ask"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_tokens_expires_idx" ON "dajc_ask"."login_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "metrics_day_idx" ON "dajc_ask"."metrics" USING btree ("day");--> statement-breakpoint
CREATE INDEX "rate_events_bucket_idx" ON "dajc_ask"."rate_events" USING btree ("bucket_key","created_at");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "dajc_ask"."sessions" USING btree ("expires_at");