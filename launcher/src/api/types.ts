export type UserRole = 'customer' | 'admin' | 'staff';

export interface User {
  _id: string;
  id?: string;
  name: string;
  email: string;
  role: UserRole;
  wishlist?: Array<string | { _id: string; id?: string }>;
  orderCount?: number;
  wishlistCount?: number;
  loyaltyPoints?: number;
  token?: string;
  createdAt?: string;
}

export interface ProductVariant {
  label: string;
  price: number;
  /** null = untracked (always available) */
  stock: number | null;
}

/** Where an imported product came from, e.g. the Audionic catalog sync. */
export interface ProductSource {
  store: string;
  productId: string;
  url?: string | null;
  /** The source store's own price (PKR for Audionic) */
  price?: number | null;
  type?: string | null;
  publishedAt?: string | null;
  syncedAt?: string | null;
}

export interface ProductSpec {
  key: string;
  value: string;
}

export type ProductType = 'standard' | 'gift_card';

export interface Product {
  _id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  stock: number | null;
  image: string;
  thumbnail?: string;
  images?: string[];
  variants?: ProductVariant[];
  specs?: ProductSpec[];
  productType?: ProductType;
  brand?: string;
  featured?: boolean;
  averageRating?: number;
  reviewCount?: number;
  source?: ProductSource | null;
}

export interface ProductListResponse {
  items: Product[];
  page?: number;
  pages?: number;
  total?: number;
  limit?: number;
}

export interface ProductFacets {
  brands: string[];
  minPrice: number;
  maxPrice: number;
}

export interface Review {
  _id: string;
  userName: string;
  rating: number;
  comment: string;
  verifiedPurchase?: boolean;
  helpfulCount?: number;
}

export interface Question {
  _id: string;
  userName: string;
  question: string;
  answer?: string;
  product?: string | { _id?: string; name?: string };
}

export interface CartItemInput {
  productId: string;
  quantity: number;
  variantLabel?: string;
  bundleId?: string | null;
}

export interface Address {
  _id: string;
  label: string;
  name: string;
  phone: string;
  address: string;
}

export interface OrderItem {
  productId?: string;
  name: string;
  price: number;
  quantity: number;
  variantLabel?: string;
  image?: string;
  bundleId?: string | null;
}

export interface Order {
  _id: string;
  customerName: string;
  email: string;
  phone?: string;
  address?: string;
  note?: string;
  status: string;
  items: OrderItem[];
  subtotal?: number;
  discount?: number;
  shippingFee?: number;
  total?: number;
  totalAmount?: number;
  shippingMethod?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  couponCode?: string;
  bundleDiscount?: number;
  pointsRedeemed?: number;
  pointsEarned?: number;
  giftCardCode?: string;
  giftCardAmount?: number;
  createdAt?: string;
  returnStatus?: string;
  returnReason?: string;
  returnRequest?: {
    status?: string;
    reason?: string;
  };
}

export interface Coupon {
  _id: string;
  code: string;
  percentOff: number;
  usageLimit: number;
  usedCount: number;
  expiresAt?: string | null;
  active: boolean;
}

export interface Category {
  _id: string;
  name: string;
}

export interface CurrencyOption {
  code: string;
  symbol: string;
  rate: number;
}

export interface StoreSettings {
  storeName?: string;
  supportEmail?: string;
  expressShippingFee?: number;
  loyaltyPointsPerDollar?: number;
  loyaltyRedemptionRate?: number;
  abandonedCartHours?: number;
  baseCurrency?: string;
  currencies?: CurrencyOption[];
  [key: string]: unknown;
}

export interface PaymentConfig {
  stripeEnabled: boolean;
  publishableKey?: string;
}

export interface CouponValidation {
  code: string;
  discount: number;
  percentOff: number;
}

export interface SuggestItem {
  _id: string;
  name: string;
}

export interface ActivityLog {
  _id: string;
  createdAt?: string;
  actorEmail?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: unknown;
}

export type NotificationType = 'order_status' | 'question_answered' | 'restock' | 'loyalty' | 'system';

export interface Notification {
  _id: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  readAt?: string | null;
  createdAt?: string;
}

export interface BundleItem {
  product: string | Product;
  quantity: number;
}

export interface Bundle {
  _id: string;
  name: string;
  description?: string;
  image?: string;
  items: BundleItem[];
  bundlePrice: number;
  active?: boolean;
  createdAt?: string;
}

export interface GiftCard {
  _id: string;
  code: string;
  initialBalance: number;
  balance: number;
  recipientEmail?: string | null;
  message?: string;
  expiresAt?: string | null;
  active: boolean;
  createdAt?: string;
}

export interface GiftCardValidation {
  code: string;
  amount: number;
  balance: number;
}

export interface LoyaltyMe {
  points: number;
  pointsPerDollar: number;
  redemptionRate: number;
  history: LoyaltyTransaction[];
}

export interface LoyaltyTransaction {
  _id: string;
  delta: number;
  reason: string;
  balanceAfter: number;
  order?: string | null;
  createdAt?: string;
}
