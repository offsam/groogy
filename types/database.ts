import type {
  AuthorVisibility,
  ListingCondition,
  ListingContactPreference,
  ListingDomain,
  ListingReportReason,
  ListingReportStatus,
  ListingStatus,
  ListingTransactionType,
  ListingType,
  ListingVisibility,
  PublisherType,
  ServicePricingType,
} from "@/types/listing";
import type {
  ImportReviewEntityType,
  ImportReviewStatus,
  ImportReviewTargetCollection,
} from "@/types/import-review";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "user" | "business_owner" | "moderator" | "admin";

export type PlatformErrorReportStatus =
  | "open"
  | "reviewed"
  | "resolved"
  | "dismissed";

export type ReviewModerationStatus =
  | "verification_pending"
  | "verification_in_progress"
  | "manual_review"
  | "published"
  | "rejected"
  | "hidden"
  | "expired";

export type ReviewVerificationLevel =
  | "unverified"
  | "ai_verified"
  | "transaction_verified";

export type ReviewVerificationSessionStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "manual_review"
  | "expired";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          username: string | null;
          avatar_url: string | null;
          bio: string | null;
          city: string | null;
          state: string | null;
          state_code: string | null;
          city_geoid: string | null;
          postal_code: string | null;
          county_geoid: string | null;
          profile_visibility: "public" | "private";
          default_author_visibility: "public" | "initials" | "anonymous";
          public_activity_enabled: boolean;
          show_reviews_in_profile: boolean;
          show_listings_in_profile: boolean;
          role: UserRole;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          username?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          city?: string | null;
          state?: string | null;
          state_code?: string | null;
          city_geoid?: string | null;
          postal_code?: string | null;
          county_geoid?: string | null;
          profile_visibility?: "public" | "private";
          default_author_visibility?: "public" | "initials" | "anonymous";
          public_activity_enabled?: boolean;
          show_reviews_in_profile?: boolean;
          show_listings_in_profile?: boolean;
          role?: UserRole;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Omit<Database["public"]["Tables"]["profiles"]["Insert"], "id">
        >;
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          slug: string;
          name: string;
          name_en: string | null;
          description: string | null;
          disclaimer_text: string | null;
          domain: string;
          icon: string | null;
          sort_order: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          name_en?: string | null;
          description?: string | null;
          disclaimer_text?: string | null;
          domain?: string;
          icon?: string | null;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["categories"]["Insert"]>;
        Relationships: [];
      };
      businesses: {
        Row: {
          id: string;
          slug: string;
          category_id: string | null;
          name: string;
          short_description: string | null;
          description: string | null;
          status: "draft" | "pending" | "approved" | "rejected" | "archived" | "deferred";
          rating_avg: number;
          reviews_count: number;
          ai_verified_reviews_count: number;
          transaction_verified_reviews_count: number;
          phone: string | null;
          email: string | null;
          website: string | null;
          instagram_url: string | null;
          telegram_url: string | null;
          source_url: string | null;
          source_kind: "telegram" | "facebook" | "directory" | "platform" | null;
          yelp_url: string | null;
          yelp_rating: number | null;
          yelp_reviews_count: number;
          trustpilot_url: string | null;
          trustpilot_rating: number | null;
          trustpilot_reviews_count: number;
          facebook_recommend_pct: number | null;
          facebook_reviews_count: number;
          instagram_followers_count: number | null;
          google_maps_url: string | null;
          google_rating: number | null;
          google_reviews_count: number;
          booking_url: string | null;
          payment_methods: string[];
          contact_links: import("@/lib/contacts/channels").ContactLink[];
          location_confidence: string | null;
          location_source: string | null;
          county_geoid: string | null;
          self_ad_mention_count: number;
          third_party_mention_count: number;
          image_url: string | null;
          address_line: string | null;
          city: string | null;
          region: string | null;
          state_code: string | null;
          city_geoid: string | null;
          postal_code: string | null;
          latitude: number | null;
          longitude: number | null;
          location_precision: "street" | "county" | null;
          opening_hours: import("@/lib/business/opening-hours").OpeningHours | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          category_id?: string | null;
          name: string;
          short_description?: string | null;
          description?: string | null;
          status?: "draft" | "pending" | "approved" | "rejected" | "archived" | "deferred";
          rating_avg?: number;
          reviews_count?: number;
          ai_verified_reviews_count?: number;
          transaction_verified_reviews_count?: number;
          phone?: string | null;
          email?: string | null;
          website?: string | null;
          instagram_url?: string | null;
          telegram_url?: string | null;
          source_url?: string | null;
          source_kind?: "telegram" | "facebook" | "directory" | "platform" | null;
          yelp_url?: string | null;
          yelp_rating?: number | null;
          yelp_reviews_count?: number;
          trustpilot_url?: string | null;
          trustpilot_rating?: number | null;
          trustpilot_reviews_count?: number;
          facebook_recommend_pct?: number | null;
          facebook_reviews_count?: number;
          instagram_followers_count?: number | null;
          google_maps_url?: string | null;
          google_rating?: number | null;
          google_reviews_count?: number;
          booking_url?: string | null;
          payment_methods?: string[];
          contact_links?: import("@/lib/contacts/channels").ContactLink[];
          location_confidence?: string | null;
          location_source?: string | null;
          county_geoid?: string | null;
          self_ad_mention_count?: number;
          third_party_mention_count?: number;
          image_url?: string | null;
          address_line?: string | null;
          city?: string | null;
          state_code?: string | null;
          city_geoid?: string | null;
          postal_code?: string | null;
          region?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          location_precision?: "street" | "county" | null;
          opening_hours?: import("@/lib/business/opening-hours").OpeningHours | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["businesses"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "businesses_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      business_offers: {
        Row: {
          id: string;
          business_id: string;
          offer_type:
            | "service"
            | "product"
            | "vehicle"
            | "property"
            | "rental"
            | "menu_item"
            | "other";
          title: string;
          slug: string;
          short_description: string | null;
          description: string | null;
          category_id: string | null;
          subcategory_id: string | null;
          status: "draft" | "active" | "archived";
          visibility: "public" | "unlisted";
          price_mode:
            | "fixed"
            | "from"
            | "range"
            | "on_request"
            | "free"
            | "contact";
          price_amount: number | null;
          price_min: number | null;
          price_max: number | null;
          currency: string;
          price_unit: string | null;
          primary_image_url: string | null;
          sort_order: number;
          is_featured: boolean;
          is_available: boolean;
          attributes: Record<string, unknown>;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          offer_type:
            | "service"
            | "product"
            | "vehicle"
            | "property"
            | "rental"
            | "menu_item"
            | "other";
          title: string;
          slug: string;
          short_description?: string | null;
          description?: string | null;
          category_id?: string | null;
          subcategory_id?: string | null;
          status?: "draft" | "active" | "archived";
          visibility?: "public" | "unlisted";
          price_mode?:
            | "fixed"
            | "from"
            | "range"
            | "on_request"
            | "free"
            | "contact";
          price_amount?: number | null;
          price_min?: number | null;
          price_max?: number | null;
          currency?: string;
          price_unit?: string | null;
          primary_image_url?: string | null;
          sort_order?: number;
          is_featured?: boolean;
          is_available?: boolean;
          attributes?: Record<string, unknown>;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["business_offers"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "business_offers_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "business_offers_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      business_offer_media: {
        Row: {
          id: string;
          offer_id: string;
          storage_path: string;
          media_type: string;
          sort_order: number;
          alt_text: string | null;
          width: number | null;
          height: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          offer_id: string;
          storage_path: string;
          media_type?: string;
          sort_order?: number;
          alt_text?: string | null;
          width?: number | null;
          height?: number | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["business_offer_media"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "business_offer_media_offer_id_fkey";
            columns: ["offer_id"];
            isOneToOne: false;
            referencedRelation: "business_offers";
            referencedColumns: ["id"];
          },
        ];
      };
      reviews: {
        Row: {
          id: string;
          business_id: string;
          user_id: string;
          rating: number;
          body: string;
          moderation_status: ReviewModerationStatus;
          verification_level: ReviewVerificationLevel;
          verification_score: number | null;
          verification_summary: string | null;
          verification_completed_at: string | null;
          transaction_verified_at: string | null;
          published_at: string | null;
          expires_at: string | null;
          author_display_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          user_id?: string;
          rating: number;
          body: string;
          moderation_status?: ReviewModerationStatus;
          verification_level?: ReviewVerificationLevel;
          verification_score?: number | null;
          verification_summary?: string | null;
          verification_completed_at?: string | null;
          transaction_verified_at?: string | null;
          published_at?: string | null;
          expires_at?: string | null;
          author_display_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["reviews"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "reviews_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      review_verification_sessions: {
        Row: {
          id: string;
          review_id: string;
          user_id: string;
          status: ReviewVerificationSessionStatus;
          current_question_index: number;
          questions_required: number;
          score: number | null;
          result_summary: string | null;
          started_at: string;
          completed_at: string | null;
          expires_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          review_id: string;
          user_id: string;
          status?: ReviewVerificationSessionStatus;
          current_question_index?: number;
          questions_required?: number;
          score?: number | null;
          result_summary?: string | null;
          started_at?: string;
          completed_at?: string | null;
          expires_at: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["review_verification_sessions"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "review_verification_sessions_review_id_fkey";
            columns: ["review_id"];
            isOneToOne: true;
            referencedRelation: "reviews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_verification_sessions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      review_verification_messages: {
        Row: {
          id: string;
          session_id: string;
          role: "agent" | "user" | "system";
          body: string;
          question_type: string | null;
          sequence_number: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          role: "agent" | "user" | "system";
          body: string;
          question_type?: string | null;
          sequence_number: number;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["review_verification_messages"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "review_verification_messages_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "review_verification_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      review_verification_reminders: {
        Row: {
          id: string;
          session_id: string;
          reminder_type: "first" | "second" | "final";
          scheduled_for: string;
          sent_at: string | null;
          status: "pending" | "sent" | "cancelled";
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          reminder_type: "first" | "second" | "final";
          scheduled_for: string;
          sent_at?: string | null;
          status?: "pending" | "sent" | "cancelled";
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["review_verification_reminders"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "review_verification_reminders_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "review_verification_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      review_replies: {
        Row: {
          id: string;
          review_id: string;
          business_id: string;
          author_user_id: string;
          body: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          review_id: string;
          business_id?: string;
          author_user_id?: string;
          body: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["review_replies"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "review_replies_review_id_fkey";
            columns: ["review_id"];
            isOneToOne: true;
            referencedRelation: "reviews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_replies_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_replies_author_user_id_fkey";
            columns: ["author_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      review_reports: {
        Row: {
          id: string;
          review_id: string;
          reporter_user_id: string;
          reason: "spam" | "offensive" | "fake" | "off_topic" | "other";
          details: string | null;
          status: "open" | "reviewed" | "dismissed";
          created_at: string;
        };
        Insert: {
          id?: string;
          review_id: string;
          reporter_user_id?: string;
          reason: "spam" | "offensive" | "fake" | "off_topic" | "other";
          details?: string | null;
          status?: "open" | "reviewed" | "dismissed";
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["review_reports"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "review_reports_review_id_fkey";
            columns: ["review_id"];
            isOneToOne: false;
            referencedRelation: "reviews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_reports_reporter_user_id_fkey";
            columns: ["reporter_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      review_abuse_events: {
        Row: {
          id: string;
          user_id: string;
          kind:
            | "review_write"
            | "review_report"
            | "listing_report"
            | "listing_create";
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          kind:
            | "review_write"
            | "review_report"
            | "listing_report"
            | "listing_create";
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["review_abuse_events"]["Insert"]
        >;
        Relationships: [];
      };

      business_owners: {
        Row: {
          business_id: string;
          user_id: string;
          role: string;
          created_at: string;
        };
        Insert: {
          business_id: string;
          user_id: string;
          role?: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["business_owners"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "business_owners_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      business_claims: {
        Row: {
          id: string;
          business_id: string;
          user_id: string;
          status: Database["public"]["Enums"]["business_claim_status"];
          verification_method: string | null;
          verification_details: string | null;
          applicant_message: string | null;
          moderator_note: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          user_id: string;
          status?: Database["public"]["Enums"]["business_claim_status"];
          verification_method?: string | null;
          verification_details?: string | null;
          applicant_message?: string | null;
          moderator_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["business_claims"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "business_claims_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      professional_claims: {
        Row: {
          id: string;
          professional_id: string;
          user_id: string;
          status: Database["public"]["Enums"]["business_claim_status"];
          verification_method: string | null;
          verification_details: string | null;
          applicant_message: string | null;
          moderator_note: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          professional_id: string;
          user_id: string;
          status?: Database["public"]["Enums"]["business_claim_status"];
          verification_method?: string | null;
          verification_details?: string | null;
          applicant_message?: string | null;
          moderator_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["professional_claims"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "professional_claims_professional_id_fkey";
            columns: ["professional_id"];
            isOneToOne: false;
            referencedRelation: "professionals";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_claims: {
        Row: {
          id: string;
          listing_id: string;
          user_id: string;
          status: Database["public"]["Enums"]["business_claim_status"];
          verification_method: string | null;
          verification_details: string | null;
          applicant_message: string | null;
          moderator_note: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          listing_id: string;
          user_id: string;
          status?: Database["public"]["Enums"]["business_claim_status"];
          verification_method?: string | null;
          verification_details?: string | null;
          applicant_message?: string | null;
          moderator_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["listing_claims"]["Insert"]
        >;
        Relationships: [];
      };
      event_claims: {
        Row: {
          id: string;
          event_id: string;
          user_id: string;
          status: Database["public"]["Enums"]["business_claim_status"];
          verification_method: string | null;
          verification_details: string | null;
          applicant_message: string | null;
          moderator_note: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          user_id: string;
          status?: Database["public"]["Enums"]["business_claim_status"];
          verification_method?: string | null;
          verification_details?: string | null;
          applicant_message?: string | null;
          moderator_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_claims"]["Insert"]>;
        Relationships: [];
      };
      job_claims: {
        Row: {
          id: string;
          job_id: string;
          user_id: string;
          status: Database["public"]["Enums"]["business_claim_status"];
          verification_method: string | null;
          verification_details: string | null;
          applicant_message: string | null;
          moderator_note: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          job_id: string;
          user_id: string;
          status?: Database["public"]["Enums"]["business_claim_status"];
          verification_method?: string | null;
          verification_details?: string | null;
          applicant_message?: string | null;
          moderator_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_claims"]["Insert"]>;
        Relationships: [];
      };
      listing_categories: {
        Row: {
          id: string;
          slug: string;
          name_ru: string;
          name_en: string | null;
          parent_id: string | null;
          listing_type: ListingType;
          domain: ListingDomain;
          sort_order: number;
          is_active: boolean;
          icon_key: string | null;
          description: string | null;
          is_selectable: boolean;
          disclaimer_text: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name_ru: string;
          name_en?: string | null;
          parent_id?: string | null;
          listing_type?: ListingType;
          domain?: ListingDomain;
          sort_order?: number;
          is_active?: boolean;
          icon_key?: string | null;
          description?: string | null;
          is_selectable?: boolean;
          disclaimer_text?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["listing_categories"]["Insert"]
        >;
        Relationships: [];
      };
      listings: {
        Row: {
          id: string;
          owner_id: string | null;
          listing_type: ListingType;
          status: ListingStatus;
          visibility: ListingVisibility;
          author_visibility: AuthorVisibility;
          title: string;
          description: string;
          price_amount: number | null;
          price_currency: string;
          is_negotiable: boolean;
          city: string | null;
          state: string | null;
          state_code: string | null;
          city_geoid: string | null;
          latitude: number | null;
          longitude: number | null;
          contact_preference: ListingContactPreference;
          publisher_type: PublisherType;
          publisher_business_id: string | null;
          payment_methods: string[];
          source_url: string | null;
          source_kind: "telegram" | "facebook" | "directory" | "platform" | null;
          published_at: string | null;
          reserved_at: string | null;
          completed_at: string | null;
          paused_at: string | null;
          archived_at: string | null;
          expires_at: string | null;
          moderation_reason: string | null;
          favorites_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id?: string | null;
          listing_type?: ListingType;
          status?: ListingStatus;
          visibility?: ListingVisibility;
          author_visibility?: AuthorVisibility;
          title: string;
          description: string;
          price_amount?: number | null;
          price_currency?: string;
          is_negotiable?: boolean;
          city?: string | null;
          state?: string | null;
          state_code?: string | null;
          city_geoid?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          contact_preference?: ListingContactPreference;
          publisher_type?: PublisherType;
          publisher_business_id?: string | null;
          payment_methods?: string[];
          source_url?: string | null;
          source_kind?: "telegram" | "facebook" | "directory" | "platform" | null;
          published_at?: string | null;
          reserved_at?: string | null;
          completed_at?: string | null;
          paused_at?: string | null;
          archived_at?: string | null;
          expires_at?: string | null;
          moderation_reason?: string | null;
          favorites_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["listings"]["Insert"]
        >;
        Relationships: [];
      };
      marketplace_listing_details: {
        Row: {
          listing_id: string;
          category_id: string | null;
          condition: ListingCondition | null;
          transaction_type: ListingTransactionType;
          delivery_available: boolean;
          pickup_available: boolean;
          quantity: number | null;
        };
        Insert: {
          listing_id: string;
          category_id?: string | null;
          condition?: ListingCondition | null;
          transaction_type?: ListingTransactionType;
          delivery_available?: boolean;
          pickup_available?: boolean;
          quantity?: number | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["marketplace_listing_details"]["Insert"]
        >;
        Relationships: [];
      };
      service_listing_details: {
        Row: {
          listing_id: string;
          service_category_id: string | null;
          pricing_type: ServicePricingType;
          price_from: number | null;
          price_to: number | null;
          price_unit: string | null;
          service_modes: string[];
          service_area: string | null;
          experience_years: number | null;
          languages: string[];
          license_info: string | null;
          insurance_status: string | null;
          availability_text: string | null;
          offers_free_estimate: boolean;
          offers_emergency_service: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          listing_id: string;
          service_category_id?: string | null;
          pricing_type?: ServicePricingType;
          price_from?: number | null;
          price_to?: number | null;
          price_unit?: string | null;
          service_modes?: string[];
          service_area?: string | null;
          experience_years?: number | null;
          languages?: string[];
          license_info?: string | null;
          insurance_status?: string | null;
          availability_text?: string | null;
          offers_free_estimate?: boolean;
          offers_emergency_service?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["service_listing_details"]["Insert"]
        >;
        Relationships: [];
      };
      transfer_listing_details: {
        Row: {
          listing_id: string;
          category_id: string | null;
          from_country: string;
          to_country: string;
          transfer_method: string;
          fee_percent: number | null;
          fee_fixed_usd: number | null;
          min_amount_usd: number | null;
          max_amount_usd: number | null;
          processing_days: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          listing_id: string;
          category_id?: string | null;
          from_country: string;
          to_country: string;
          transfer_method?: string;
          fee_percent?: number | null;
          fee_fixed_usd?: number | null;
          min_amount_usd?: number | null;
          max_amount_usd?: number | null;
          processing_days?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["transfer_listing_details"]["Insert"]
        >;
        Relationships: [];
      };
      lechu_listing_details: {
        Row: {
          listing_id: string;
          category_id: string | null;
          departure_country: string;
          destination_country: string;
          departure_date: string | null;
          carry_types: string[];
          max_weight_kg: number | null;
          size_limit: string | null;
          reward_type: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          listing_id: string;
          category_id?: string | null;
          departure_country: string;
          destination_country: string;
          departure_date?: string | null;
          carry_types?: string[];
          max_weight_kg?: number | null;
          size_limit?: string | null;
          reward_type?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["lechu_listing_details"]["Insert"]
        >;
        Relationships: [];
      };
      listing_media: {
        Row: {
          id: string;
          listing_id: string;
          storage_path: string;
          media_type: string;
          sort_order: number;
          width: number | null;
          height: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          listing_id: string;
          storage_path: string;
          media_type?: string;
          sort_order?: number;
          width?: number | null;
          height?: number | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["listing_media"]["Insert"]
        >;
        Relationships: [];
      };
      listing_favorites: {
        Row: {
          user_id: string;
          listing_id: string;
          created_at: string;
        };
        Insert: {
          user_id?: string;
          listing_id: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["listing_favorites"]["Insert"]
        >;
        Relationships: [];
      };
      listing_reports: {
        Row: {
          id: string;
          listing_id: string;
          reporter_id: string;
          reason: ListingReportReason;
          details: string | null;
          status: ListingReportStatus;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          listing_id: string;
          reporter_id?: string;
          reason: ListingReportReason;
          details?: string | null;
          status?: ListingReportStatus;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["listing_reports"]["Insert"]
        >;
        Relationships: [];
      };
      listing_admin_audit: {
        Row: {
          id: string;
          listing_id: string;
          admin_id: string;
          action: string;
          from_status: ListingStatus | null;
          to_status: ListingStatus | null;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          listing_id: string;
          admin_id: string;
          action: string;
          from_status?: ListingStatus | null;
          to_status?: ListingStatus | null;
          reason?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["listing_admin_audit"]["Insert"]
        >;
        Relationships: [];
      };
      platform_currencies: {
        Row: {
          code: string;
          name_en: string;
          symbol: string;
          minor_units: number;
          is_active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          name_en: string;
          symbol: string;
          minor_units?: number;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["platform_currencies"]["Insert"]
        >;
        Relationships: [];
      };
      platform_countries: {
        Row: {
          iso2: string;
          iso3: string;
          name_en: string;
          name_ru: string | null;
          phone_code: string | null;
          default_currency_code: string | null;
          is_active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          iso2: string;
          iso3: string;
          name_en: string;
          name_ru?: string | null;
          phone_code?: string | null;
          default_currency_code?: string | null;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["platform_countries"]["Insert"]
        >;
        Relationships: [];
      };
      platform_subdivisions: {
        Row: {
          code: string;
          country_iso2: string;
          fips_code: string | null;
          abbreviation: string;
          name_en: string;
          name_ru: string | null;
          slug: string;
          is_active: boolean;
          is_selectable: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          country_iso2: string;
          fips_code?: string | null;
          abbreviation: string;
          name_en: string;
          name_ru?: string | null;
          slug: string;
          is_active?: boolean;
          is_selectable?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["platform_subdivisions"]["Insert"]
        >;
        Relationships: [];
      };
      platform_counties: {
        Row: {
          geoid: string;
          state_code: string;
          fips_code: string;
          name: string;
          name_normalized: string;
          slug: string;
          is_active: boolean;
          latitude: number | null;
          longitude: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          geoid: string;
          state_code: string;
          fips_code: string;
          name: string;
          name_normalized: string;
          slug: string;
          is_active?: boolean;
          latitude?: number | null;
          longitude?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["platform_counties"]["Insert"]
        >;
        Relationships: [];
      };
      platform_cities: {
        Row: {
          geoid: string;
          state_code: string;
          primary_county_geoid: string | null;
          ansicode: string | null;
          name: string;
          name_normalized: string;
          slug: string;
          lsad: string | null;
          latitude: number | null;
          longitude: number | null;
          land_sq_mi: number | null;
          is_active: boolean;
          population: number | null;
          population_year: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          geoid: string;
          state_code: string;
          primary_county_geoid?: string | null;
          ansicode?: string | null;
          name: string;
          name_normalized: string;
          slug: string;
          lsad?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          land_sq_mi?: number | null;
          is_active?: boolean;
          population?: number | null;
          population_year?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["platform_cities"]["Insert"]
        >;
        Relationships: [];
      };
      platform_city_counties: {
        Row: {
          city_geoid: string;
          county_geoid: string;
          created_at: string;
        };
        Insert: {
          city_geoid: string;
          county_geoid: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["platform_city_counties"]["Insert"]
        >;
        Relationships: [];
      };
      platform_languages: {
        Row: {
          code: string;
          name_en: string;
          name_native: string | null;
          name_ru: string | null;
          is_rtl: boolean;
          is_active: boolean;
          sort_order: number;
          search_aliases: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          name_en: string;
          name_native?: string | null;
          name_ru?: string | null;
          is_rtl?: boolean;
          is_active?: boolean;
          sort_order?: number;
          search_aliases?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["platform_languages"]["Insert"]
        >;
        Relationships: [];
      };
      platform_units: {
        Row: {
          code: string;
          category: "count" | "time" | "distance" | "area" | "mass";
          label_en_singular: string;
          label_en_plural: string;
          label_ru_singular: string | null;
          label_ru_plural: string | null;
          short_label: string | null;
          is_active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          category: "count" | "time" | "distance" | "area" | "mass";
          label_en_singular: string;
          label_en_plural: string;
          label_ru_singular?: string | null;
          label_ru_plural?: string | null;
          short_label?: string | null;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["platform_units"]["Insert"]
        >;
        Relationships: [];
      };
      platform_features: {
        Row: {
          id: string;
          code: string;
          domains: string[];
          name_en: string;
          name_ru: string | null;
          description: string | null;
          is_active: boolean;
          sort_order: number;
          verification_status_supported: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          domains: string[];
          name_en: string;
          name_ru?: string | null;
          description?: string | null;
          is_active?: boolean;
          sort_order?: number;
          verification_status_supported?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["platform_features"]["Insert"]
        >;
        Relationships: [];
      };
      platform_data_sources: {
        Row: {
          id: string;
          source_name: string;
          dataset_name: string;
          version: string | null;
          retrieved_at: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          source_name: string;
          dataset_name: string;
          version?: string | null;
          retrieved_at?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["platform_data_sources"]["Insert"]
        >;
        Relationships: [];
      };
      platform_events: {
        Row: {
          id: string;
          event_type: "page_view" | "search" | "click" | "contact_reveal";
          path: string;
          referrer: string | null;
          user_id: string | null;
          meta: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_type: "page_view" | "search" | "click" | "contact_reveal";
          path?: string;
          referrer?: string | null;
          user_id?: string | null;
          meta?: Record<string, unknown>;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["platform_events"]["Insert"]
        >;
        Relationships: [];
      };
      platform_error_reports: {
        Row: {
          id: string;
          message: string;
          page_path: string;
          page_url: string | null;
          user_id: string | null;
          user_agent: string | null;
          status: PlatformErrorReportStatus;
          admin_note: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          message: string;
          page_path: string;
          page_url?: string | null;
          user_id?: string | null;
          user_agent?: string | null;
          status?: PlatformErrorReportStatus;
          admin_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["platform_error_reports"]["Insert"]
        >;
        Relationships: [];
      };
      entity_enrich_runs: {
        Row: {
          admin_id: string | null;
          created_at: string;
          entity_id: string;
          entity_kind: string;
          id: string;
          note: string | null;
          payload: Json;
        }
        Insert: {
          admin_id?: string | null;
          created_at?: string;
          entity_id: string;
          entity_kind: string;
          id?: string;
          note?: string | null;
          payload?: Json;
        }
        Update: {
          admin_id?: string | null;
          created_at?: string;
          entity_id?: string;
          entity_kind?: string;
          id?: string;
          note?: string | null;
          payload?: Json;
        }
        Relationships: []
      }
      entity_moves: {
        Row: {
          created_at: string;
          from_id: string;
          from_path: string;
          from_slug: string | null;
          from_type: string;
          id: string;
          moved_by: string | null;
          reason: string | null;
          to_id: string;
          to_path: string;
          to_slug: string | null;
          to_type: string;
        }
        Insert: {
          created_at?: string;
          from_id: string;
          from_path: string;
          from_slug?: string | null;
          from_type: string;
          id?: string;
          moved_by?: string | null;
          reason?: string | null;
          to_id: string;
          to_path: string;
          to_slug?: string | null;
          to_type: string;
        }
        Update: {
          created_at?: string;
          from_id?: string;
          from_path?: string;
          from_slug?: string | null;
          from_type?: string;
          id?: string;
          moved_by?: string | null;
          reason?: string | null;
          to_id?: string;
          to_path?: string;
          to_slug?: string | null;
          to_type?: string;
        }
        Relationships: []
      }
      entity_promotions: {
        Row: {
          body: string | null;
          category_id: string | null;
          created_at: string;
          discount_label: string | null;
          discount_percent: number | null;
          id: string;
          owner_id: string;
          owner_type: string;
          sort_order: number;
          source_import_item_id: string | null;
          status: string;
          title: string;
          updated_at: string;
          valid_from: string | null;
          valid_until: string | null;
        }
        Insert: {
          body?: string | null;
          category_id?: string | null;
          created_at?: string;
          discount_label?: string | null;
          discount_percent?: number | null;
          id?: string;
          owner_id: string;
          owner_type: string;
          sort_order?: number;
          source_import_item_id?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
          valid_from?: string | null;
          valid_until?: string | null;
        }
        Update: {
          body?: string | null;
          category_id?: string | null;
          created_at?: string;
          discount_label?: string | null;
          discount_percent?: number | null;
          id?: string;
          owner_id?: string;
          owner_type?: string;
          sort_order?: number;
          source_import_item_id?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
          valid_from?: string | null;
          valid_until?: string | null;
        }
        Relationships: [
          {
            foreignKeyName: "entity_promotions_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ]
      }
      entity_updates: {
        Row: {
          body: string | null;
          created_at: string;
          id: string;
          owner_id: string;
          owner_type: string;
          published_at: string;
          source: string;
          source_url: string | null;
          status: string;
          title: string;
          updated_at: string;
        }
        Insert: {
          body?: string | null;
          created_at?: string;
          id?: string;
          owner_id: string;
          owner_type: string;
          published_at?: string;
          source?: string;
          source_url?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
        }
        Update: {
          body?: string | null;
          created_at?: string;
          id?: string;
          owner_id?: string;
          owner_type?: string;
          published_at?: string;
          source?: string;
          source_url?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        }
        Relationships: []
      }
      import_review_items: {
        Row: {
          id: string;
          source: string;
          source_group: string | null;
          source_chat_id: string | null;
          source_message_ids: number[];
          source_fingerprint: string;
          source_author_id: string | null;
          source_author_username: string | null;
          source_author_display_name: string | null;
          source_posted_at: string | null;
          source_text: string | null;
          source_url: string | null;
          source_media: Record<string, unknown>[];
          ai_decision: string | null;
          ai_confidence: number | null;
          ai_reason: string | null;
          entity_type: ImportReviewEntityType | null;
          target_collection: ImportReviewTargetCollection | null;
          category: string | null;
          subcategory: string | null;
          title: string | null;
          business_name: string | null;
          person_name: string | null;
          description: string | null;
          services: string[];
          payment_methods: string[];
          updates: import("@/types/update").QueueUpdate[] | null;
          promotions: import("@/types/promotion").QueuePromotion[] | null;
          location_confidence: string | null;
          location_source: string | null;
          county_geoid: string | null;
          address_line: string | null;
          price: number | null;
          currency: string | null;
          city: string | null;
          state: string | null;
          phone: string[];
          whatsapp: string[];
          telegram_username: string | null;
          telegram_user_id: string | null;
          instagram: string[];
          website: string[];
          email: string[];
          photos_count: number;
          preview_image_url: string | null;
          duplicate_status: string | null;
          recurring_cluster_id: string | null;
          occurrence_count: number | null;
          first_seen: string | null;
          last_seen: string | null;
          raw_payload: Record<string, unknown>;
          review_status: ImportReviewStatus;
          review_notes: string | null;
          reject_reason: string | null;
          duplicate_of_item_id: string | null;
          duplicate_of_entity_type: string | null;
          duplicate_of_entity_id: string | null;
          published_entity_type: string | null;
          published_entity_id: string | null;
          published_at: string | null;
          last_renewed_at: string | null;
          expires_at: string | null;
          approved_at: string | null;
          approved_by: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<
          Database["public"]["Tables"]["import_review_items"]["Row"]
        > & {
          source_fingerprint: string;
          raw_payload: Record<string, unknown>;
        };
        Update: Partial<
          Database["public"]["Tables"]["import_review_items"]["Row"]
        >;
        Relationships: [];
      };
      import_review_audit: {
        Row: {
          id: string;
          item_id: string;
          admin_id: string | null;
          action: string;
          previous_status: ImportReviewStatus | null;
          new_status: ImportReviewStatus | null;
          changed_fields: Record<string, unknown>;
          created_entity_type: string | null;
          created_entity_id: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          item_id: string;
          admin_id?: string | null;
          action: string;
          previous_status?: ImportReviewStatus | null;
          new_status?: ImportReviewStatus | null;
          changed_fields?: Record<string, unknown>;
          created_entity_type?: string | null;
          created_entity_id?: string | null;
          note?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["import_review_audit"]["Insert"]
        >;
        Relationships: [];
      };
    };
    Views: {
      businesses_public: {
        Row: {
          id: string;
          slug: string;
          category_id: string | null;
          name: string;
          short_description: string | null;
          description: string | null;
          status: "draft" | "pending" | "approved" | "rejected" | "archived" | "deferred";
          rating_avg: number;
          reviews_count: number;
          ai_verified_reviews_count: number;
          transaction_verified_reviews_count: number;
          google_rating: number | null;
          google_reviews_count: number;
          yelp_rating: number | null;
          yelp_reviews_count: number;
          trustpilot_rating: number | null;
          trustpilot_reviews_count: number;
          facebook_recommend_pct: number | null;
          facebook_reviews_count: number;
          instagram_followers_count: number | null;
          image_url: string | null;
          city: string | null;
          region: string | null;
          state_code: string | null;
          postal_code: string | null;
          latitude: number | null;
          longitude: number | null;
          location_precision: "street" | "county" | null;
          opening_hours: import("@/lib/business/opening-hours").OpeningHours | null;
          created_at: string;
          updated_at: string;
          has_phone: boolean;
          has_email: boolean;
          has_website: boolean;
          has_instagram: boolean;
          has_telegram: boolean;
          has_yelp: boolean;
          has_trustpilot: boolean;
          has_facebook: boolean;
          has_google_maps: boolean;
          has_source: boolean;
          has_booking: boolean;
        };
        Relationships: [];
      };
      marketplace_catalog: {
        Row: {
          id: string;
          title: string;
          description: string;
          price_amount: number | null;
          price_currency: string;
          is_negotiable: boolean;
          city: string | null;
          state: string | null;
          author_visibility: AuthorVisibility;
          published_at: string | null;
          updated_at: string;
          favorites_count: number;
          publisher_type: PublisherType;
          category_id: string | null;
          condition: ListingCondition | null;
          transaction_type: ListingTransactionType;
          category_slug: string | null;
          category_name_ru: string | null;
          publisher: Record<string, unknown> | null;
        };
        Relationships: [];
      };
      services_catalog: {
        Row: {
          id: string;
          title: string;
          description: string;
          price_amount: number | null;
          price_currency: string;
          is_negotiable: boolean;
          city: string | null;
          state: string | null;
          author_visibility: AuthorVisibility;
          published_at: string | null;
          updated_at: string;
          favorites_count: number;
          publisher_type: PublisherType;
          service_category_id: string | null;
          pricing_type: ServicePricingType;
          price_from: number | null;
          price_to: number | null;
          price_unit: string | null;
          service_modes: string[];
          service_area: string | null;
          experience_years: number | null;
          languages: string[];
          offers_free_estimate: boolean;
          offers_emergency_service: boolean;
          category_slug: string | null;
          category_name_ru: string | null;
          publisher: Record<string, unknown> | null;
        };
        Relationships: [];
      };
      transfers_catalog: {
        Row: {
          id: string;
          title: string;
          description: string;
          price_amount: number | null;
          price_currency: string;
          city: string | null;
          state: string | null;
          author_visibility: AuthorVisibility;
          published_at: string | null;
          updated_at: string;
          favorites_count: number;
          publisher_type: PublisherType;
          from_country: string;
          to_country: string;
          transfer_method: string;
          fee_percent: number | null;
          fee_fixed_usd: number | null;
          min_amount_usd: number | null;
          max_amount_usd: number | null;
          processing_days: number | null;
          category_slug: string | null;
          category_name_ru: string | null;
          publisher: Record<string, unknown> | null;
        };
        Relationships: [];
      };
      lechu_catalog: {
        Row: {
          id: string;
          title: string;
          description: string;
          price_amount: number | null;
          price_currency: string;
          city: string | null;
          state: string | null;
          author_visibility: AuthorVisibility;
          published_at: string | null;
          updated_at: string;
          favorites_count: number;
          publisher_type: PublisherType;
          departure_country: string;
          destination_country: string;
          departure_date: string | null;
          carry_types: string[];
          max_weight_kg: number | null;
          size_limit: string | null;
          reward_type: string;
          category_slug: string | null;
          category_name_ru: string | null;
          publisher: Record<string, unknown> | null;
        };
        Relationships: [];
      };
      business_offers_public: {
        Row: {
          id: string;
          business_id: string;
          business_slug: string;
          business_name: string;
          offer_type:
            | "service"
            | "product"
            | "vehicle"
            | "property"
            | "rental"
            | "menu_item"
            | "other";
          title: string;
          slug: string;
          short_description: string | null;
          price_mode:
            | "fixed"
            | "from"
            | "range"
            | "on_request"
            | "free"
            | "contact";
          price_amount: number | null;
          price_min: number | null;
          price_max: number | null;
          currency: string;
          price_unit: string | null;
          primary_image_url: string | null;
          is_featured: boolean;
          is_available: boolean;
          sort_order: number;
          published_at: string | null;
          attributes: Record<string, unknown>;
        };
        Relationships: [];
      };
      platform_us_states_public: {
        Row: {
          code: string;
          country_iso2: string;
          fips_code: string | null;
          abbreviation: string;
          name_en: string;
          name_ru: string | null;
          slug: string;
          sort_order: number;
        };
        Relationships: [];
      };
      platform_languages_public: {
        Row: {
          code: string;
          name_en: string;
          name_native: string | null;
          name_ru: string | null;
          is_rtl: boolean;
          sort_order: number;
          search_aliases: string[];
        };
        Relationships: [];
      };
      platform_currencies_public: {
        Row: {
          code: string;
          name_en: string;
          symbol: string;
          minor_units: number;
          sort_order: number;
        };
        Relationships: [];
      };
      platform_units_public: {
        Row: {
          code: string;
          category: string;
          label_en_singular: string;
          label_en_plural: string;
          label_ru_singular: string | null;
          label_ru_plural: string | null;
          short_label: string | null;
          sort_order: number;
        };
        Relationships: [];
      };
      platform_features_public: {
        Row: {
          id: string;
          code: string;
          domains: string[];
          name_en: string;
          name_ru: string | null;
          description: string | null;
          sort_order: number;
          verification_status_supported: boolean;
        };
        Relationships: [];
      };
    };
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      owns_business: { Args: { p_business_id: string }; Returns: boolean };
      hide_own_review: { Args: { p_review_id: string }; Returns: undefined };
      create_verification_session: {
        Args: { p_review_id: string };
        Returns: Database["public"]["Tables"]["review_verification_sessions"]["Row"];
      };
      submit_verification_answer: {
        Args: { p_session_id: string; p_answer: string };
        Returns: Record<string, unknown>;
      };
      complete_verification_session: {
        Args: { p_session_id: string };
        Returns: Record<string, unknown>;
      };
      admin_set_review_moderation: {
        Args: {
          p_review_id: string;
          p_moderation_status: ReviewModerationStatus;
          p_verification_level?: ReviewVerificationLevel | null;
        };
        Returns: undefined;
      };
      admin_set_report_status: {
        Args: {
          p_report_id: string;
          p_status: "open" | "reviewed" | "dismissed";
        };
        Returns: undefined;
      };
      assert_review_write_rate_limit: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      assert_review_report_rate_limit: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      refresh_business_rating: {
        Args: { p_business_id: string };
        Returns: undefined;
      };
      expire_stale_verifications: {
        Args: Record<string, never>;
        Returns: number;
      };
      resolve_author_display: {
        Args: {
          p_user_id: string;
          p_author_visibility?: AuthorVisibility | null;
        };
        Returns: Record<string, unknown>;
      };
      get_public_profile: {
        Args: { p_username: string };
        Returns: Record<string, unknown> | null;
      };
      get_platform_resource_stats: {
        Args: Record<string, never>;
        Returns: Record<string, unknown>;
      };
      popular_resource_scores: {
        Args: { p_days?: number; p_limit?: number };
        Returns: {
          entity_type: string;
          entity_id: string;
          score: number;
        }[];
      };
      admin_set_listing_status: {
        Args: {
          p_listing_id: string;
          p_status: ListingStatus;
          p_reason?: string | null;
        };
        Returns: undefined;
      };
      admin_import_review_counts: {
        Args: Record<string, never>;
        Returns: {
          total: number;
          by_status: Record<string, number>;
          by_collection: Record<string, number>;
        };
      };
      admin_list_import_review_items: {
        Args: {
          p_review_status?: string | null;
          p_target_collection?: string | null;
          p_entity_type?: string | null;
          p_category?: string | null;
          p_city?: string | null;
          p_has_phone?: boolean;
          p_has_telegram?: boolean;
          p_has_instagram?: boolean;
          p_has_website?: boolean;
          p_has_media?: boolean;
          p_duplicate_status?: string | null;
          p_confidence_min?: number | null;
          p_confidence_max?: number | null;
          p_posted_from?: string | null;
          p_posted_to?: string | null;
          p_q?: string | null;
          p_sort?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: {
          item: Record<string, unknown>;
          total_count: number;
          contact_priority_score: number;
          completeness_score: number;
          contact_level: string;
        }[];
      };
      import_review_contact_priority_score: {
        Args: {
          p_phone: string[];
          p_whatsapp: string[];
          p_telegram_username: string | null;
          p_email: string[];
          p_website: string[];
          p_instagram: string[];
          p_source_url: string | null;
          p_telegram_user_id: string | null;
        };
        Returns: number;
      };
      admin_import_review_save_fields: {
        Args: { p_item_id: string; p_fields: Record<string, unknown> };
        Returns: Database["public"]["Tables"]["import_review_items"]["Row"];
      };
      admin_import_review_set_status: {
        Args: {
          p_item_id: string;
          p_status: ImportReviewStatus;
          p_notes?: string | null;
          p_reject_reason?: string | null;
          p_duplicate_of_item_id?: string | null;
          p_duplicate_of_entity_type?: string | null;
          p_duplicate_of_entity_id?: string | null;
        };
        Returns: Database["public"]["Tables"]["import_review_items"]["Row"];
      };
      admin_import_review_mark_approved: {
        Args: {
          p_item_id: string;
          p_published_entity_type: string;
          p_published_entity_id: string;
        };
        Returns: Database["public"]["Tables"]["import_review_items"]["Row"];
      };
      import_review_publish_gate_check: {
        Args: { p_item_id: string };
        Returns: string[];
      };
      admin_import_review_write_audit: {
        Args: {
          p_item_id: string;
          p_action: string;
          p_previous_status: ImportReviewStatus | null;
          p_new_status: ImportReviewStatus | null;
          p_changed_fields?: Record<string, unknown>;
          p_created_entity_type?: string | null;
          p_created_entity_id?: string | null;
          p_note?: string | null;
        };
        Returns: string;
      };
      admin_set_business_status: {
        Args: {
          p_business_id: string;
          p_status: "pending" | "approved" | "rejected" | "archived" | "deferred";
        };
        Returns: undefined;
      };
      admin_set_business_category: {
        Args: {
          p_business_id: string;
          p_category_id: string | null;
        };
        Returns: undefined;
      };
      admin_merge_businesses: {
        Args: {
          p_keep_id: string;
          p_drop_id: string;
        };
        Returns: Record<string, unknown>;
      };
      admin_set_listing_report_status: {
        Args: {
          p_report_id: string;
          p_status: ListingReportStatus;
        };
        Returns: undefined;
      };
      stable_user_number: {
        Args: { p_user_id: string };
        Returns: number;
      };
      author_initials: {
        Args: { p_display_name: string };
        Returns: string;
      };
      get_public_profile_listings: {
        Args: { p_username: string };
        Returns: Database["public"]["Tables"]["listings"]["Row"][];
      };
      get_public_profile_service_listings: {
        Args: { p_username: string };
        Returns: Database["public"]["Tables"]["listings"]["Row"][];
      };
      resolve_listing_publisher: {
        Args: {
          p_publisher_type: PublisherType;
          p_publisher_business_id: string | null;
          p_owner_id: string;
          p_author_visibility?: AuthorVisibility | null;
        };
        Returns: Record<string, unknown>;
      };
      marketplace_looks_like_service: {
        Args: { p_title: string; p_description: string };
        Returns: boolean;
      };
      transition_listing_status: {
        Args: {
          p_listing_id: string;
          p_from: ListingStatus;
          p_to: ListingStatus;
        };
        Returns: Database["public"]["Tables"]["listings"]["Row"];
      };
      listing_storage_object_readable: {
        Args: { p_name: string };
        Returns: boolean;
      };
      listing_storage_object_owned: {
        Args: { p_name: string };
        Returns: boolean;
      };
      normalize_place_name: {
        Args: { p_name: string };
        Returns: string;
      };
      search_platform_cities: {
        Args: {
          p_query: string;
          p_state_code?: string | null;
          p_limit?: number;
        };
        Returns: {
          geoid: string;
          state_code: string;
          name: string;
          name_normalized: string;
          slug: string;
          latitude: number | null;
          longitude: number | null;
          population: number | null;
        }[];
      };
      admin_upsert_listing_category: {
        Args: {
          p_id?: string | null;
          p_slug?: string | null;
          p_name_ru?: string | null;
          p_name_en?: string | null;
          p_parent_id?: string | null;
          p_listing_type?: ListingType | null;
          p_domain?: ListingDomain | null;
          p_sort_order?: number | null;
          p_is_active?: boolean | null;
          p_icon_key?: string | null;
          p_description?: string | null;
          p_is_selectable?: boolean | null;
          p_disclaimer_text?: string | null;
        };
        Returns: string;
      };
      admin_set_listing_category_active: {
        Args: { p_id: string; p_is_active: boolean };
        Returns: undefined;
      };
      admin_upsert_feature: {
        Args: {
          p_id?: string | null;
          p_code?: string | null;
          p_domains?: string[] | null;
          p_name_en?: string | null;
          p_name_ru?: string | null;
          p_description?: string | null;
          p_is_active?: boolean | null;
          p_sort_order?: number | null;
          p_verification_status_supported?: boolean | null;
        };
        Returns: string;
      };
      admin_set_language_active: {
        Args: { p_code: string; p_is_active: boolean };
        Returns: undefined;
      };
      admin_set_language_sort: {
        Args: { p_code: string; p_sort_order: number };
        Returns: undefined;
      };
      admin_set_location_active: {
        Args: { p_kind: string; p_id: string; p_is_active: boolean };
        Returns: undefined;
      };
      admin_set_user_role: {
        Args: { p_user_id: string; p_role: UserRole };
        Returns: undefined;
      };
      admin_list_pending_business_claims: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          business_id: string;
          business_slug: string;
          business_name: string;
          user_id: string;
          applicant_display_name: string | null;
          applicant_email: string | null;
          verification_method: string | null;
          verification_details: string | null;
          applicant_message: string | null;
          created_at: string;
        }[];
      };
      admin_review_business_claim: {
        Args: {
          p_claim_id: string;
          p_decision: string;
          p_moderator_note?: string | null;
        };
        Returns: undefined;
      };
      admin_list_pending_professional_claims: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          professional_id: string;
          professional_slug: string;
          professional_name: string;
          user_id: string;
          applicant_display_name: string | null;
          applicant_email: string | null;
          verification_method: string | null;
          verification_details: string | null;
          applicant_message: string | null;
          created_at: string;
        }[];
      };
      admin_review_professional_claim: {
        Args: {
          p_claim_id: string;
          p_decision: string;
          p_moderator_note?: string | null;
        };
        Returns: undefined;
      };
      admin_list_pending_listing_claims: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          listing_id: string;
          listing_type: string;
          listing_title: string;
          user_id: string;
          applicant_display_name: string | null;
          applicant_email: string | null;
          verification_method: string | null;
          verification_details: string | null;
          applicant_message: string | null;
          created_at: string;
        }[];
      };
      admin_review_listing_claim: {
        Args: {
          p_claim_id: string;
          p_decision: string;
          p_moderator_note?: string | null;
        };
        Returns: undefined;
      };
      admin_list_pending_event_claims: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          event_id: string;
          event_slug: string;
          event_title: string;
          user_id: string;
          applicant_display_name: string | null;
          applicant_email: string | null;
          verification_method: string | null;
          verification_details: string | null;
          applicant_message: string | null;
          created_at: string;
        }[];
      };
      admin_review_event_claim: {
        Args: {
          p_claim_id: string;
          p_decision: string;
          p_moderator_note?: string | null;
        };
        Returns: undefined;
      };
      admin_list_pending_job_claims: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          job_id: string;
          job_slug: string;
          job_title: string;
          user_id: string;
          applicant_display_name: string | null;
          applicant_email: string | null;
          verification_method: string | null;
          verification_details: string | null;
          applicant_message: string | null;
          created_at: string;
        }[];
      };
      admin_review_job_claim: {
        Args: {
          p_claim_id: string;
          p_decision: string;
          p_moderator_note?: string | null;
        };
        Returns: undefined;
      };
      business_is_claimed: {
        Args: { p_business_id: string };
        Returns: boolean;
      };
      admin_list_users: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          email: string | null;
          display_name: string | null;
          role: UserRole;
          created_at: string;
          updated_at: string;
        }[];
      };
      get_admin_platform_analytics: {
        Args: Record<string, never>;
        Returns: Record<string, unknown>;
      };
      admin_delete_business: {
        Args: { p_business_id: string };
        Returns: undefined;
      };
      admin_upsert_business: {
        Args: {
          p_id?: string | null;
          p_name: string;
          p_slug: string;
          p_short_description?: string | null;
          p_description?: string | null;
          p_phone?: string | null;
          p_website?: string | null;
          p_city?: string | null;
          p_address_line?: string | null;
          p_status?:
            | "draft"
            | "pending"
            | "approved"
            | "rejected"
            | "archived"
            | "deferred";
          p_category_id?: string | null;
          p_instagram_url?: string | null;
          p_google_maps_url?: string | null;
          p_google_rating?: number | null;
          p_google_reviews_count?: number | null;
        };
        Returns: string;
      };
    };
    Enums: {
      content_status: "draft" | "pending" | "approved" | "rejected" | "archived" | "deferred";
      user_role: UserRole;
      business_claim_status: "pending" | "approved" | "rejected" | "cancelled";
      review_moderation_status: ReviewModerationStatus;
      review_verification_level: ReviewVerificationLevel;
      review_verification_session_status: ReviewVerificationSessionStatus;
      review_verification_message_role: "agent" | "user" | "system";
      review_reminder_type: "first" | "second" | "final";
      review_reminder_status: "pending" | "sent" | "cancelled";
      review_report_status: "open" | "reviewed" | "dismissed";
      review_report_reason: "spam" | "offensive" | "fake" | "off_topic" | "other";
      profile_visibility: "public" | "private";
      author_visibility: AuthorVisibility;
      listing_type: ListingType;
      listing_status: ListingStatus;
      listing_visibility: ListingVisibility;
      listing_condition: ListingCondition;
      listing_transaction_type: ListingTransactionType;
      listing_report_reason: ListingReportReason;
      listing_report_status: ListingReportStatus;
      listing_contact_preference: ListingContactPreference;
      listing_publisher_type: PublisherType;
      listing_domain: ListingDomain;
      service_pricing_type: ServicePricingType;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type CategoryRow = Database["public"]["Tables"]["categories"]["Row"];
export type BusinessRow = Database["public"]["Tables"]["businesses"]["Row"];
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

export type BusinessWithCategory = BusinessRow & {
  categories: Pick<CategoryRow, "id" | "slug" | "name" | "icon"> | null;
};
