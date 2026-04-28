"use client";

import {
baseAccount as wagmiBaseAccountConnector,
type BaseAccountParameters,
} from "wagmi/connectors";

type BaseAccountConnectorParameters = BaseAccountParameters & {
  displayName?: string;
};

export function baseAccountConnector(
  parameters: BaseAccountConnectorParameters = {},
) {
  const { displayName, ...baseParameters } = parameters;
  void displayName;

  return wagmiBaseAccountConnector({
    appName: baseParameters.appName ?? "Pixotchi Mini",
    appLogoUrl: baseParameters.appLogoUrl ?? null,
    paymasterUrls: baseParameters.paymasterUrls,
    preference: baseParameters.preference,
    subAccounts: baseParameters.subAccounts,
  });
}
