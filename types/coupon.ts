export type Coupon = {
  id: string;
  curatorProfileId: string;
  curatorDisplayName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  title: string;
  body: string;
  imageUrl: string | null;
  linkUrl: string | null;
  promoCode: string | null;
  status: "published" | "archived";
  source: "direct" | "submission";
  publishedAt: string;
  createdAt: string;
  commentCount?: number;
};

export type CouponComment = {
  id: string;
  couponId: string;
  profileId: string;
  authorName: string | null;
  body: string;
  createdAt: string;
};

export type CouponSubmissionStatus = "pending" | "approved" | "rejected";

export type CouponSubmission = {
  id: string;
  submittedByProfileId: string;
  submitterName: string | null;
  title: string;
  body: string;
  imageUrl: string | null;
  linkUrl: string | null;
  status: CouponSubmissionStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  resultingCouponId: string | null;
  createdAt: string;
};
