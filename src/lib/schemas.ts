import { z } from "zod";

export const SignupSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(80).optional(),
  ref: z.string().max(40).optional(),
  locale: z.enum(["en", "fr", "ar"]).optional(),
  captchaToken: z.string().max(4096).optional(),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const ForgotPasswordSchema = z.object({ email: z.string().email() });
export const ResetPasswordSchema = z.object({
  token: z.string().min(8),
  password: z.string().min(8).max(200),
});
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});
export const VerifyEmailSchema = z.object({ token: z.string().min(8) });

export const SearchRequestSchema = z.object({
  niche: z.string().min(1).max(200),
  keywords: z.string().max(200).optional(),
  location: z.string().min(1).max(200),
  countryCode: z.string().length(2).optional(),
  countryName: z.string().max(80).optional(),
  radiusKm: z.number().positive().max(500).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  maxResults: z.number().int().positive().max(10000).optional(),
  providers: z.array(z.string()).optional(),
  useDemo: z.boolean().optional(),
});

export const UpdateLeadSchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "REJECTED"]).optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().max(5000).optional(),
  followUpAt: z.string().datetime().nullable().optional(),
});

export const BulkLeadsSchema = z.object({
  ids: z.array(z.string()).min(1).max(5000),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "REJECTED"]).optional(),
  delete: z.boolean().optional(),
});

export const ExportRequestSchema = z.object({
  format: z.enum(["csv", "xlsx", "json"]),
  leadIds: z.array(z.string()).optional(),
  filters: z
    .object({
      status: z.string().optional(),
      country: z.string().optional(),
      source: z.string().optional(),
      tag: z.string().optional(),
      searchId: z.string().optional(),
    })
    .optional(),
  searchId: z.string().optional(),
});

export const CheckoutSchema = z.object({
  planId: z.string(),
  couponCode: z.string().optional(),
});

export const CouponValidateSchema = z.object({
  code: z.string().min(1),
  planId: z.string(),
});

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().optional(),
});

export const AffiliateApplySchema = z.object({});

export type SignupInput = z.infer<typeof SignupSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type SearchInput = z.infer<typeof SearchRequestSchema>;
