CREATE TABLE IF NOT EXISTS "alert_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"cluster_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"metric" varchar(255) NOT NULL,
	"threshold" numeric(10, 2) NOT NULL,
	"operator" varchar(20) NOT NULL,
	"duration" integer NOT NULL,
	"severity" varchar(50) DEFAULT 'warning',
	"is_enabled" boolean DEFAULT true,
	"conditions" jsonb,
	"notification_channels" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"kubeconfig" text,
	"api_server_url" varchar(500),
	"version" varchar(50),
	"node_count" integer DEFAULT 0,
	"health_score" numeric(5, 2) DEFAULT '0.00',
	"status" varchar(50) DEFAULT 'disconnected',
	"last_sync_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "health_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"health_score" numeric(5, 2) NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"details" jsonb,
	"pod_status" jsonb,
	"node_status" jsonb,
	"network_status" jsonb,
	"storage_status" jsonb,
	"uptime" numeric(5, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"cluster_id" uuid NOT NULL,
	"alert_policy_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"severity" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'open',
	"value" numeric(10, 2),
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp,
	"resolved_by" uuid,
	"resolved_at" timestamp,
	"root_cause" text,
	"resolution" text,
	"related_events" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"avatar" varchar(500),
	"role" varchar(50) DEFAULT 'user',
	"is_active" boolean DEFAULT true,
	"last_login" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(50) DEFAULT 'member',
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"description" text,
	"owner_id" uuid NOT NULL,
	"logo" varchar(500),
	"metadata" jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_policies_workspace_id_idx" ON "alert_policies" ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_policies_cluster_id_idx" ON "alert_policies" ("cluster_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_policies_enabled_idx" ON "alert_policies" ("is_enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clusters_workspace_id_idx" ON "clusters" ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clusters_status_idx" ON "clusters" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "health_snapshots_cluster_id_idx" ON "health_snapshots" ("cluster_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "health_snapshots_timestamp_idx" ON "health_snapshots" ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "health_snapshots_cluster_timestamp_idx" ON "health_snapshots" ("cluster_id","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_workspace_id_idx" ON "incidents" ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_cluster_id_idx" ON "incidents" ("cluster_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_status_idx" ON "incidents" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_severity_idx" ON "incidents" ("severity");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_created_at_idx" ON "incidents" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_active_idx" ON "users" ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_members_workspace_id_idx" ON "workspace_members" ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_members_user_id_idx" ON "workspace_members" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspaces_owner_id_idx" ON "workspaces" ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspaces_slug_idx" ON "workspaces" ("slug");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_policies" ADD CONSTRAINT "alert_policies_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_policies" ADD CONSTRAINT "alert_policies_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "clusters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_policies" ADD CONSTRAINT "alert_policies_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clusters" ADD CONSTRAINT "clusters_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "health_snapshots" ADD CONSTRAINT "health_snapshots_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "clusters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "clusters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_alert_policy_id_fk" FOREIGN KEY ("alert_policy_id") REFERENCES "alert_policies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_acknowledged_by_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolved_by_fk" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
