CREATE TYPE "public"."intelligence_billing_period" AS ENUM('MONTH', 'YEAR');--> statement-breakpoint
CREATE TYPE "public"."intelligence_member_role" AS ENUM('OWNER', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."intelligence_member_status" AS ENUM('ACTIVE', 'SUSPENDED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."intelligence_organisation_status" AS ENUM('ACTIVE', 'SUSPENDED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."intelligence_subscription_request_status" AS ENUM('REQUESTED', 'INVOICED', 'PAID', 'CANCELLED');--> statement-breakpoint
ALTER TYPE "public"."portal_actor_type" ADD VALUE 'CUSTOMER';--> statement-breakpoint
ALTER TYPE "public"."portal_principal_type" ADD VALUE 'CUSTOMER';--> statement-breakpoint
CREATE TABLE "intelligence_calendar_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"organisation_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"filter" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "intelligence_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"features" text[] DEFAULT '{}'::text[] NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'MANUAL' NOT NULL,
	"payment_reference" text,
	"request_id" uuid,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text
);
--> statement-breakpoint
CREATE TABLE "intelligence_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "intelligence_member_role" DEFAULT 'MEMBER' NOT NULL,
	"status" "intelligence_member_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "intelligence_organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"country" text NOT NULL,
	"registration_id" text NOT NULL,
	"vat_id" text,
	"billing_email" text NOT NULL,
	"status" "intelligence_organisation_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intelligence_subscription_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"features" text[] NOT NULL,
	"period" "intelligence_billing_period" NOT NULL,
	"status" "intelligence_subscription_request_status" DEFAULT 'REQUESTED' NOT NULL,
	"payment_reference" text,
	"note" text,
	"decided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intelligence_calendar_tokens" ADD CONSTRAINT "intelligence_calendar_tokens_organisation_id_intelligence_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."intelligence_organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_calendar_tokens" ADD CONSTRAINT "intelligence_calendar_tokens_member_id_intelligence_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."intelligence_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_entitlements" ADD CONSTRAINT "intelligence_entitlements_organisation_id_intelligence_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."intelligence_organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_members" ADD CONSTRAINT "intelligence_members_organisation_id_intelligence_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."intelligence_organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_subscription_requests" ADD CONSTRAINT "intelligence_subscription_requests_organisation_id_intelligence_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."intelligence_organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_subscription_requests" ADD CONSTRAINT "intelligence_subscription_requests_requested_by_intelligence_members_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."intelligence_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "intelligence_calendar_tokens_hash_uq" ON "intelligence_calendar_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "intelligence_calendar_tokens_id_uq" ON "intelligence_calendar_tokens" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "intelligence_calendar_tokens_member_idx" ON "intelligence_calendar_tokens" USING btree ("organisation_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "intelligence_entitlements_one_current_uq" ON "intelligence_entitlements" USING btree ("organisation_id") WHERE "intelligence_entitlements"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "intelligence_members_email_uq" ON "intelligence_members" USING btree ("email");--> statement-breakpoint
CREATE INDEX "intelligence_members_organisation_idx" ON "intelligence_members" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "intelligence_requests_organisation_idx" ON "intelligence_subscription_requests" USING btree ("organisation_id","created_at");