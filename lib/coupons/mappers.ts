import type { Coupon, CouponComment, CouponSubmission } from "@/types/coupon";

type CouponRow = {
  id: string;
  curator_profile_id: string;
  curator_display_name: string | null;
  category_id: string | null;
  title: string;
  body: string;
  image_url: string | null;
  link_url: string | null;
  promo_code: string | null;
  status: "published" | "archived";
  source: "direct" | "submission";
  published_at: string;
  created_at: string;
  categories?: { name: string } | { name: string }[] | null;
};

export function mapCoupon(row: CouponRow): Coupon {
  const cat = Array.isArray(row.categories) ? row.categories[0] : row.categories;
  return {
    id: row.id,
    curatorProfileId: row.curator_profile_id,
    curatorDisplayName: row.curator_display_name,
    categoryId: row.category_id,
    categoryName: cat?.name ?? null,
    title: row.title,
    body: row.body,
    imageUrl: row.image_url,
    linkUrl: row.link_url,
    promoCode: row.promo_code,
    status: row.status,
    source: row.source,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}

type CommentRow = {
  id: string;
  coupon_id: string;
  profile_id: string;
  body: string;
  created_at: string;
  profiles?: { display_name: string | null } | { display_name: string | null }[] | null;
};

export function mapCouponComment(row: CommentRow): CouponComment {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    id: row.id,
    couponId: row.coupon_id,
    profileId: row.profile_id,
    authorName: profile?.display_name ?? null,
    body: row.body,
    createdAt: row.created_at,
  };
}

type SubmissionRow = {
  id: string;
  submitted_by_profile_id: string;
  title: string;
  body: string;
  image_url: string | null;
  link_url: string | null;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  resulting_coupon_id: string | null;
  created_at: string;
  profiles?: { display_name: string | null } | { display_name: string | null }[] | null;
};

export function mapCouponSubmission(row: SubmissionRow): CouponSubmission {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    id: row.id,
    submittedByProfileId: row.submitted_by_profile_id,
    submitterName: profile?.display_name ?? null,
    title: row.title,
    body: row.body,
    imageUrl: row.image_url,
    linkUrl: row.link_url,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    resultingCouponId: row.resulting_coupon_id,
    createdAt: row.created_at,
  };
}
