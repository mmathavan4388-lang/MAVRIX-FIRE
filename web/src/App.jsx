import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { useApp } from './store.jsx';
import { storedLang, useT } from './i18n.jsx';
import { Splash, Toast, Spinner, ErrorBox } from './ui.jsx';
import { LanguageSelect, LoginPage, RegisterPage } from './pages/auth.jsx';
import * as C from './pages/customer.jsx';
import { PanelLayout, PanelNotifications } from './pages/panel.jsx';

const SELLER_NAV = [['/seller', 'chart', 'seller.dashboard', true], ['/seller/products', 'box', 'seller.products'], ['/seller/orders', 'bag', 'seller.orders'], ['/seller/offers', 'tag', 'seller.offers'],
  ['/seller/reviews', 'star', 'seller.reviews'], ['/seller/payments', 'wallet', 'seller.payments'], ['/seller/shop', 'store', 'seller.shop']];

const ADMIN_NAV = [['/admin', 'chart', 'admin.dashboard', true], ['/admin/sellers', 'store', 'admin.sellers'], ['/admin/customers', 'users', 'admin.customers'], ['/admin/products', 'box', 'admin.products'],
  ['/admin/categories', 'list', 'admin.categories'], ['/admin/orders', 'bag', 'admin.orders'], ['/admin/finance', 'wallet', 'admin.finance'], ['/admin/support', 'message', 'admin.support'],
  ['/admin/complaints', 'flag', 'admin.complaints'], ['/admin/reviews', 'star', 'admin.reviews'], ['/admin/offers', 'tag', 'admin.offers'], ['/admin/banners', 'image', 'admin.banners'],
  ['/admin/broadcast', 'bell', 'admin.broadcast'], ['/admin/audit', 'shield', 'admin.audit'], ['/admin/settings', 'settings', 'admin.settings']];


// Seller and admin screens are loaded on demand so the customer app stays small on mobile networks.
const lazyOf = (loader) => new Proxy({}, { get: (cache, name) => (cache[name] ??= lazy(() => loader().then((m) => ({ default: m[name] })))) });
const S = lazyOf(() => import('./pages/seller.jsx'));
const A = lazyOf(() => import('./pages/admin.jsx'));

const Cust = ({ children }) => <C.RequireCustomer>{children}</C.RequireCustomer>;
const sellerNotifLink = (n) => (n.data?.subOrderId ? '/seller/orders' : n.kind.startsWith('product') || n.kind.includes('stock') ? '/seller/products' : n.kind.startsWith('subscription') || n.kind === 'payout_status' ? '/seller/payments' : n.kind === 'new_review' ? '/seller/reviews' : null);
const adminNotifLink = (n) => (n.kind.startsWith('support') ? '/admin/support' : n.kind === 'new_seller' || n.kind === 'seller_resubmitted' ? '/admin/sellers?status=pending' : n.kind === 'product_pending' ? '/admin/products?status=pending'
  : n.kind === 'new_order' || n.kind === 'order_cancelled' || n.kind === 'payment_issue' ? '/admin/orders' : n.kind === 'review_reported' ? '/admin/reviews' : n.kind === 'subscription_paid' ? '/admin/finance?tab=subscriptions' : null);

function Gate({ children }) {
  const { config, configError, loadConfig, booting } = useApp(); const loc = useLocation();
  const panel = loc.pathname.startsWith('/admin') || loc.pathname.startsWith('/seller');
  const [splash, setSplash] = useState(!panel); const [needLang, setNeedLang] = useState(!storedLang() && !panel);
  useEffect(() => { if (!splash) return undefined; const id = setTimeout(() => setSplash(false), 1400); return () => clearTimeout(id); }, [splash]);
  if (splash) return <Splash />;
  if (needLang) return <LanguageSelect onDone={() => setNeedLang(false)} />;
  if (configError) return <ErrorBox error={{ status: 0 }} onRetry={loadConfig} />;
  if (!config || booting) return <Spinner />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Gate>
        <Suspense fallback={<Spinner />}>
        <Routes>
          <Route element={<C.CustomerShell />}>
            <Route index element={<C.Home />} />
            <Route path="search" element={<C.Search />} />
            <Route path="product/:id" element={<C.ProductPage />} />
            <Route path="shop/:slug" element={<C.ShopPage />} />
            <Route path="cart" element={<Cust><C.CartPage /></Cust>} />
            <Route path="checkout" element={<Cust><C.CheckoutPage /></Cust>} />
            <Route path="orders" element={<Cust><C.OrdersPage /></Cust>} />
            <Route path="orders/:id" element={<Cust><C.OrderDetail /></Cust>} />
            <Route path="wishlist" element={<Cust><C.WishlistPage /></Cust>} />
            <Route path="notifications" element={<Cust><C.NotificationsPage /></Cust>} />
            <Route path="support" element={<Cust><C.SupportList /></Cust>} />
            <Route path="support/new" element={<Cust><C.SupportNew /></Cust>} />
            <Route path="support/:id" element={<Cust><C.SupportThread /></Cust>} />
            <Route path="profile" element={<C.ProfilePage />} />
            <Route path="safety" element={<C.SafetyPage />} />
          </Route>
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="seller/register" element={<S.SellerRegister />} />
          <Route path="seller" element={<PanelLayout role="seller" base="/seller" items={S.SELLER_NAV} />}>
            <Route index element={<S.SellerDashboard />} />
            <Route path="products" element={<S.SellerProducts />} />
            <Route path="products/:id" element={<S.ProductForm />} />
            <Route path="orders" element={<S.SellerOrders />} />
            <Route path="offers" element={<S.SellerOffers />} />
            <Route path="reviews" element={<S.SellerReviews />} />
            <Route path="payments" element={<S.SellerPayments />} />
            <Route path="shop" element={<S.SellerShop />} />
            <Route path="notifications" element={<PanelNotifications linkFor={sellerNotifLink} />} />
          </Route>
          <Route path="admin/setup" element={<A.AdminSetup />} />
          <Route path="admin/login" element={<A.AdminLogin />} />
          <Route path="admin" element={<PanelLayout role="admin" base="/admin" items={A.ADMIN_NAV} />}>
            <Route index element={<A.AdminDashboard />} />
            <Route path="sellers" element={<A.AdminSellers />} />
            <Route path="customers" element={<A.AdminCustomers />} />
            <Route path="products" element={<A.AdminProducts />} />
            <Route path="categories" element={<A.AdminCategories />} />
            <Route path="orders" element={<A.AdminOrders />} />
            <Route path="finance" element={<A.AdminFinance />} />
            <Route path="support" element={<A.AdminSupport />} />
            <Route path="complaints" element={<A.AdminSupport complaints />} />
            <Route path="reviews" element={<A.AdminReviews />} />
            <Route path="offers" element={<A.AdminOffers />} />
            <Route path="banners" element={<A.AdminBanners />} />
            <Route path="broadcast" element={<A.AdminBroadcast />} />
            <Route path="audit" element={<A.AdminAudit />} />
            <Route path="settings" element={<A.AdminSettings />} />
            <Route path="notifications" element={<PanelNotifications linkFor={adminNotifLink} />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </Gate>
      <Toast />
    </BrowserRouter>
  );
}
