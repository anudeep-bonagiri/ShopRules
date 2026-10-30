"use client";

import { AppProvider, Frame, Navigation, TopBar } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import {
  AlertTriangleIcon,
  HomeIcon,
  ListBulletedIcon,
  ProductIcon,
  ReceiptIcon,
  SettingsIcon,
} from "@shopify/polaris-icons";
import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";

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

export function AppFrame({ children, openAlerts = 0 }: { children: ReactNode; openAlerts?: number }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [query, setQuery] = useState("");

  const toggleMobileNav = useCallback(() => setMobileNavOpen((v) => !v), []);
  const toggleUserMenu = useCallback(() => setUserMenuOpen((v) => !v), []);

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

  const searchField = (
    <TopBar.SearchField
      value={query}
      onChange={setQuery}
      placeholder="Search products and alerts"
      showFocusBorder
    />
  );

  const topBar = (
    <TopBar
      showNavigationToggle
      userMenu={userMenu}
      searchField={searchField}
      searchResultsVisible={false}
      onSearchResultsDismiss={() => setQuery("")}
      onNavigationToggle={toggleMobileNav}
    />
  );

  const navigation = (
    <Navigation location={pathname}>
      <Navigation.Section
        items={[
          { url: "/", label: "Home", icon: HomeIcon, selected: isActive("/"), onClick: () => router.push("/") },
          { url: "/products", label: "Products", icon: ProductIcon, selected: isActive("/products") },
          {
            url: "/alerts",
            label: "Alerts",
            icon: AlertTriangleIcon,
            selected: isActive("/alerts"),
            badge: openAlerts > 0 ? String(openAlerts) : undefined,
          },
          { url: "/rules", label: "Watch rules", icon: ListBulletedIcon, selected: isActive("/rules") },
          { url: "/receipt", label: "Cost receipt", icon: ReceiptIcon, selected: isActive("/receipt") },
        ]}
      />
      <Navigation.Section
        separator
        title="Account"
        items={[{ url: "/settings", label: "Settings", icon: SettingsIcon, selected: isActive("/settings") }]}
      />
    </Navigation>
  );

  const logo = {
    width: 124,
    topBarSource: "/logo.svg",
    contextualSaveBarSource: "/logo.svg",
    url: "/",
    accessibilityLabel: "Shop Rules",
  };

  return (
    <AppProvider i18n={enTranslations} linkComponent={Link}>
      <Frame
        logo={logo}
        topBar={topBar}
        navigation={navigation}
        showMobileNavigation={mobileNavOpen}
        onNavigationDismiss={() => setMobileNavOpen(false)}
      >
        {children}
      </Frame>
    </AppProvider>
  );
}
