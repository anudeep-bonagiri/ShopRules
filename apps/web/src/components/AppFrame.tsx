"use client";

import { AppProvider, Frame, Navigation, TopBar } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { AlertTriangleIcon, HomeIcon, ListBulletedIcon, ProductIcon, ReceiptIcon, SettingsIcon } from "@shopify/polaris-icons";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useApi } from "@/lib/client";
import type { AlertRow } from "@/lib/db";
import { BottomTabs } from "@/components/stitch";

// Mirrors Polaris's LinkLikeComponentProps, which the package does not export.
interface LinkLikeProps {
  url: string;
  children?: ReactNode;
  external?: boolean;
  [key: string]: any;
}

function Link({ url, children, external, ...rest }: LinkLikeProps) {
  if (external || /^https?:\/\//.test(url)) {
    return (
      <a href={url} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <NextLink href={url} {...rest}>
      {children}
    </NextLink>
  );
}

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Open-alert count for the badges. Re-read on every route change so it
  // follows the seller's actions without a global store.
  const open = useApi<{ alerts: AlertRow[] }>("/api/alerts?status=new", [pathname]);
  const openCount = open.data?.alerts.length ?? 0;

  const toggleMobileNav = useCallback(() => setMobileNavOpen((v) => !v), []);
  const toggleUserMenu = useCallback(() => setUserMenuOpen((v) => !v), []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  const isActive = (url: string) => (url === "/" ? pathname === "/" : pathname.startsWith(url));

  const userMenu = (
    <TopBar.UserMenu
      name="Seller"
      detail="Shop Rules workspace"
      initials="S"
      open={userMenuOpen}
      onToggle={toggleUserMenu}
      actions={[{ items: [{ content: "Settings", url: "/settings" }, { content: "Cost receipt", url: "/receipt" }] }]}
    />
  );

  const topBar = <TopBar showNavigationToggle userMenu={userMenu} onNavigationToggle={toggleMobileNav} />;

  const navigation = (
    <Navigation location={pathname}>
      <Navigation.Section
        items={[
          { url: "/", label: "Watchlist", icon: HomeIcon, selected: isActive("/"), exactMatch: true },
          { url: "/products", label: "Inspector", icon: ProductIcon, selected: isActive("/products") },
          {
            url: "/alerts",
            label: "Alerts",
            icon: AlertTriangleIcon,
            selected: isActive("/alerts"),
            badge: openCount > 0 ? String(openCount) : undefined,
          },
          { url: "/rules", label: "Watch rules", icon: ListBulletedIcon, selected: isActive("/rules") },
          { url: "/receipt", label: "Cost receipt", icon: ReceiptIcon, selected: isActive("/receipt") },
        ]}
      />
      <Navigation.Section separator title="Account" items={[{ url: "/settings", label: "Settings", icon: SettingsIcon, selected: isActive("/settings") }]} />
    </Navigation>
  );

  const logo = {
    width: 150,
    topBarSource: "/logo-lockup.png",
    contextualSaveBarSource: "/logo-lockup.png",
    url: "/",
    accessibilityLabel: "Shop Rules",
  };

  return (
    <AppProvider i18n={enTranslations} linkComponent={Link}>
      <Frame logo={logo} topBar={topBar} navigation={navigation} showMobileNavigation={mobileNavOpen} onNavigationDismiss={() => setMobileNavOpen(false)}>
        {children}
        <BottomTabs openCount={openCount} />
      </Frame>
    </AppProvider>
  );
}
