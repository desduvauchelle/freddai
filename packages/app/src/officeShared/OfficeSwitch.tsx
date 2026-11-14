import { Office, type OfficeProps } from "../office/index";
import { Office7 } from "../office7";
import { useOfficeVersion } from "./officeVersion";
import "./officeShared.css";

/** Drop-in office: Campus (v7) by default, Classic (v1) as the alternative. Only routes; each variant renders its own <OfficeVersionPicker /> in its bottom control row. */
export function OfficeSwitch(props: OfficeProps) {
  const [version] = useOfficeVersion();
  return version === "v7" ? <Office7 {...props} /> : <Office {...props} />;
}
