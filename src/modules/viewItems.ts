import { PatchHelper } from "zotero-plugin-toolkit";
import { getPref } from "../utils/prefs";

export function patchViewItems(win: _ZoteroTypes.MainWindow) {
  // @ts-ignore
  const ZoteroPane = win.ZoteroPane;
  new PatchHelper().setData({
    target: ZoteroPane,
    funcSign: "viewItems",
    patcher: (origin) =>
      function (items: Zotero.Item[], event?: KeyboardEvent) {
        if (!addon.data.alive || event?.shiftKey) {
          // @ts-ignore
          return origin.apply(this, [items, event]);
        }
        const otherItems = [];
        for (const item of items) {
          if (item.isNote()) {
            addon.hooks.onOpenNote(
              item.id,
              getPref("openNote.defaultAsWindow") ? "preview" : "builtin",
            );
            continue;
          }
          otherItems.push(item);
        }
        // @ts-ignore
        return origin.apply(this, [otherItems, event]);
      },
    enabled: true,
  });
}
