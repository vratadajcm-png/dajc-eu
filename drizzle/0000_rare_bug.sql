CREATE TYPE "public"."portal_actor_type" AS ENUM('ADMIN', 'PARTNER_CONTACT', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."api_client_status" AS ENUM('PENDING', 'ACTIVE', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."portal_environment" AS ENUM('SANDBOX', 'PRODUCTION');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."partner_contact_role" AS ENUM('PARTNER_ADMIN', 'DEVELOPER', 'READ_ONLY');--> statement-breakpoint
CREATE TYPE "public"."partner_contact_status" AS ENUM('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."partner_status" AS ENUM('PENDING', 'VERIFIED', 'SANDBOX', 'PRODUCTION', 'SUSPENDED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."portal_principal_type" AS ENUM('ADMIN', 'PARTNER_CONTACT');--> statement-breakpoint
CREATE TABLE "partner_portal_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"api_client_id" uuid NOT NULL,
	"tenant_ref" text NOT NULL,
	"scope" text NOT NULL,
	"environment" "portal_environment" NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "partner_portal_api_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"environment" "portal_environment" NOT NULL,
	"status" "api_client_status" DEFAULT 'PENDING' NOT NULL,
	"allowed_scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "partner_portal_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"actor_type" "portal_actor_type" NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"partner_id" uuid,
	"metadata" jsonb,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_portal_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"issued_by" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"status" "invitation_status" DEFAULT 'PENDING' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_portal_login_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_type" "portal_principal_type" NOT NULL,
	"principal_ref" text NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "partner_portal_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "partner_contact_role" DEFAULT 'DEVELOPER' NOT NULL,
	"status" "partner_contact_status" DEFAULT 'INVITED' NOT NULL,
	"verified_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_portal_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"country" text NOT NULL,
	"registration_id" text NOT NULL,
	"vat_id" text,
	"website" text,
	"primary_contact_name" text NOT NULL,
	"primary_contact_email" text NOT NULL,
	"use_case_description" text NOT NULL,
	"requested_integration_type" text NOT NULL,
	"status" "partner_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "partner_portal_rate_limit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bucket_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_portal_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_type" "portal_principal_type" NOT NULL,
	"principal_ref" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "partner_portal_access_grants" ADD CONSTRAINT "partner_portal_access_grants_partner_id_partner_portal_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner_portal_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_portal_access_grants" ADD CONSTRAINT "partner_portal_access_grants_api_client_id_partner_portal_api_clients_id_fk" FOREIGN KEY ("api_client_id") REFERENCES "public"."partner_portal_api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_portal_api_clients" ADD CONSTRAINT "partner_portal_api_clients_partner_id_partner_portal_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner_portal_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_portal_audit_log" ADD CONSTRAINT "partner_portal_audit_log_partner_id_partner_portal_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner_portal_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_portal_invitations" ADD CONSTRAINT "partner_portal_invitations_partner_id_partner_portal_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner_portal_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_portal_contacts" ADD CONSTRAINT "partner_portal_contacts_partner_id_partner_portal_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner_portal_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_audit_log_partner_created_idx" ON "partner_portal_audit_log" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_invitations_token_hash_uq" ON "partner_portal_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_login_tokens_token_hash_uq" ON "partner_portal_login_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_contacts_partner_email_uq" ON "partner_portal_contacts" USING btree ("partner_id","email");--> statement-breakpoint
CREATE INDEX "partner_rate_limit_bucket_created_idx" ON "partner_portal_rate_limit_events" USING btree ("bucket_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_sessions_token_hash_uq" ON "partner_portal_sessions" USING btree ("token_hash");