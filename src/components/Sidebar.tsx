import {
  FileTextOutlined,
  GoldOutlined,
  HomeOutlined,
  PieChartOutlined,
  SettingOutlined,
  TableOutlined,
  UnorderedListOutlined,
  UploadOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { Menu } from "antd";
import { PATHS } from "../nav";
import { APP_NAME, APP_TAGLINE } from "../brand";

const ITEMS = [
  {
    type: "group" as const,
    label: "Today",
    children: [{ key: PATHS.overview, icon: <HomeOutlined />, label: "Home" }],
  },
  {
    type: "group" as const,
    label: "Money in & out",
    children: [
      { key: PATHS.transactions, icon: <UnorderedListOutlined />, label: "Bookings" },
      { key: PATHS.cash, icon: <WalletOutlined />, label: "Cash" },
      { key: PATHS.gold, icon: <GoldOutlined />, label: "Gold" },
    ],
  },
  {
    type: "group" as const,
    label: "Plan",
    children: [
      { key: PATHS.budgets, icon: <PieChartOutlined />, label: "Budgets" },
      { key: PATHS.report, icon: <TableOutlined />, label: "Year" },
    ],
  },
  {
    type: "group" as const,
    label: "Recurring",
    children: [{ key: PATHS.contracts, icon: <FileTextOutlined />, label: "Contracts" }],
  },
  {
    type: "group" as const,
    label: "Setup",
    children: [
      { key: PATHS.import, icon: <UploadOutlined />, label: "Import" },
      { key: PATHS.rules, icon: <SettingOutlined />, label: "Rules" },
    ],
  },
];

export function Brand() {
  return (
    <div className="app-brand">
      <img className="app-brand-mark" src="/logo.svg" width={40} height={40} alt="" />
      <div className="app-brand-text">
        <span className="app-brand-kicker">{APP_TAGLINE}</span>
        <div className="app-brand-title">{APP_NAME}</div>
      </div>
    </div>
  );
}

export function Sidebar({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <>
      <Brand />
      <Menu
        mode="inline"
        selectedKeys={[pathname === "/" ? PATHS.overview : pathname]}
        items={ITEMS}
        onClick={({ key }) => onNavigate(key)}
        className="app-menu"
      />
    </>
  );
}
