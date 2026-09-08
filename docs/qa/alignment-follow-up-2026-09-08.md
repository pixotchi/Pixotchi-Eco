# Alignment follow-up — 8 September 2026

This follow-up checks for defects similar to the Wallet Address row that wrapped unnecessarily. Nine production files were changed. The findings below group related CSS defects rather than count every affected JSX row.

| Area | Before | After |
| --- | --- | --- |
| Shared resource amounts | Resource text sat 1.5px below adjacent labels in production summaries and building information. | `ResourceValue` aligns its inline line box to the surrounding text. Measured text offset is 0px. Icon/text centering inside the value is retained. |
| Plant profile credit | “Powered by” sat 5px above the EFP link text. | The row uses centered alignment and no manual top offset. Remaining 0.5px difference is font-metric rounding. |
| Building information | Enlarged nested padding and unshrinkable values collapsed some labels to zero width; troop/stat values overlapped at 320–390px with 200% text. | Horizontal padding retains its normal pixel size. Narrow containers reflow stat rows, and troop metadata can wrap. |
| Shared amount fields | Input padding consumed the entire input width beside Max; a 178px row needed 189px at 320px/200% text. | The input keeps a useful preferred width. Max reflows to the following row only when the pair cannot fit; labels and feedback can wrap. Normal-size input/button geometry is unchanged in the measured cases. |
| Dialog headings | Long words exceeded the heading/description width reserved beside the close button; Marketplace's 150px title area contained 261px of text at 320px/200%. | Titles and descriptions break long words when necessary without escaping the header. |
| Staking | Reward values were squeezed to 7–12px beside fixed labels; the action toggle and Refresh needed 341px in a 178px row. | Labels, values, and toolbar controls reflow when their combined width is unavailable. |
| Marketplace | Community/order-book headings, token selector, tip/Clear, Orders/filter, and order summary/action rows competed for insufficient width. A summary narrowed to 16px beside its action. | Header/action groups wrap; order summaries keep a useful preferred width and actions move below them when required. |
| Admin headers | Chat/AI headings and action groups could push Refresh outside the viewport. | Header controls wrap and remain within their section. |
| Admin message metadata | Authors, timestamps, badges, and addresses could push delete/view controls outside cards or overlap them. | Content can shrink and wrap while action buttons retain their size. |

## Changed files

- `components/ui/resource-value.tsx`
- `components/ui/amount-field.tsx`
- `components/ui/dialog.tsx`
- `components/building-info-dialog.tsx`
- `components/plant-profile-dialog.tsx`
- `components/staking/staking-dialog.tsx`
- `components/transactions/marketplace-dialog.tsx`
- `components/admin/admin-chat-section.tsx`
- `components/admin/admin-ai-chat-section.tsx`

All changes concern layout and text reflow. No transaction behavior, copy, features, or button-size defaults were changed.

## Validation

- Resource alignment alternatives were measured in real production components: `middle` gave +1.5px, `baseline` -2px, `text-bottom` -1px, and `top` 0px. `top` was selected to keep wrapped amounts aligned with the first line of surrounding text.
- Building information and production: 24 controlled renders (three surfaces × four widths × 100%/200% text), with no measured row overflow after correction. Existing building P3 component smoke passed.
- Profile credit: measured and visually checked at 320, 390, 820, and 1440px, including doubled text. Existing Chromium and WebKit profile checks passed.
- Staking/Marketplace: 16 final controlled renders (two dialogs × four widths × 100%/200%), with no overflowing descendants in the checked states. Fresh Tailwind CSS was compiled to include newly added utilities. Wallet/RPC calls were mocked; the original economic fixtures did not serve decorative images, so those screenshots verify geometry, not artwork loading.
- Admin Chat/AI Chat: actual components with mocked GET reads at the four widths and 100%/200% text; no outlying controls. Three existing admin layout checks passed.
- Twenty final integration checks passed across Chromium 320/390/820/1440 and WebKit 390: amount-field behavior/association, economic dialogs at normal/enlarged text, and shared surface/header layout.
- The economy pass also ran 28 existing Mint/Swap/dialog checks and eight final dialog checks; all passed. These counts overlap the final integration cases and should not be summed as unique tests.
- `npx tsc --noEmit`, scoped ESLint, and whitespace checks passed after the changes.

Evidence remains under `output/playwright/alignment-*` and `output/alignment-land-*.jsonl`. Representative retained screenshots include `alignment-profile-before-390.png`, `alignment-profile-after-390-1.png`, `alignment-land-info-390-after.png`, and `alignment-admin-after.png`. Some exploratory before screenshots were overwritten during iteration; retained numerical before evidence and tool captures are used instead of mislabeling later screenshots as originals.

## Coverage limits

The source sweep included shared controls/dialogs, amount/name fields, wallet/balances, Mint/Swap/staking/Marketplace, plant care/buildings, profiles/rankings, chat/tasks/activity, arcade/casino, map/status, and admin message surfaces. Suspected defects received targeted rendering; intentional wrapping/top alignment was retained. This does not establish exhaustive browser coverage of every wallet, game state, notification, or device. Earlier checks covered overflow and control access more thoroughly than text baselines; the explicit text/row geometry measurements in this pass caught the smaller offsets.

No live transaction or admin write was submitted, no server was restarted, and no commit/push/deployment was made. The initial audit and its external/native acceptance boundary remain separate from this follow-up.
