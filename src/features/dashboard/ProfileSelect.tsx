import type { FinancialProfile } from "../../domain/models";
import { AccessibleSelect } from "./AccessibleSelect";

export function ProfileSelect({
  profiles,
  value,
  onChange,
  label = "Perfil",
  includeAll = false,
  autoFocus = false,
  disabled = false,
  className,
  invalid = false,
  describedBy,
}: {
  profiles: FinancialProfile[];
  value: string;
  onChange: (profileId: string) => void;
  label?: string;
  includeAll?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <AccessibleSelect
      options={[
        ...(includeAll ? [{ value: "", label: "Todos os perfis" }] : []),
        ...profiles.map((profile) => ({
          value: profile.id,
          label: profile.name,
        })),
      ]}
      value={value}
      onChange={onChange}
      label={label}
      autoFocus={autoFocus}
      disabled={disabled}
      className={className}
      invalid={invalid}
      describedBy={describedBy}
    />
  );
}
