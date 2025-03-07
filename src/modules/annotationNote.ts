import { config } from "../../package.json";
import { ICONS } from "../utils/config";
import { getNoteLinkParams } from "../utils/link";
import { addLineToNote } from "../utils/note";
import { getPref } from "../utils/prefs";

export { registerReaderAnnotationButton, syncAnnotationNoteTags };

function registerReaderAnnotationButton() {
  Zotero.Reader.registerEventListener(
    "renderSidebarAnnotationHeader",
    (event) => {
      const { doc, append, params, reader } = event;
      const annotationData = params.annotation;
      const button = ztoolkit.UI.createElement(doc, "div", {
        classList: ["icon"],
        properties: {
          innerHTML: getAnnotationNoteButtonInnerHTML(false),
          title: getAnnotationNoteButtonTitle(false),
        },
        listeners: [
          {
            type: "click",
            listener: (e) => {
              const button = e.currentTarget as HTMLElement;
              createNoteFromAnnotation(
                reader._item.libraryID,
                annotationData.id,
                (e as MouseEvent).shiftKey ? "preview" : "builtin",
              );
              button.innerHTML = getAnnotationNoteButtonInnerHTML(true);
              e.preventDefault();
            },
          },
        ],
        enableElementRecord: false,
      });
      updateAnnotationNoteButton(
        button,
        reader._item.libraryID,
        annotationData.id,
      );
      append(button);
    },
    config.addonID,
  );
}

function getAnnotationNoteButtonInnerHTML(hasNote: boolean) {
  return `${hasNote ? ICONS.openInNewWindow : ICONS.readerQuickNote}
<style>
  .icon {
    border-radius: 4px;
    color: #ffd400;
  }
  .icon:hover {
    background-color: var(--fill-quinary);
    outline: 2px solid var(--fill-quinary);
  }
  .icon:active {
    background-color: var(--fill-quarternary);
  }
</style>
  `;
}

function getAnnotationNoteButtonTitle(hasNote: boolean) {
  return hasNote ? "Open note" : "Create note from annotation";
}

function updateAnnotationNoteButton(
  button: HTMLElement,
  libraryID: number,
  itemKey: string,
) {
  hasNoteFromAnnotation(libraryID, itemKey).then((hasNote) => {
    button.innerHTML = getAnnotationNoteButtonInnerHTML(hasNote);
    button.title = getAnnotationNoteButtonTitle(hasNote);
  });
}

async function hasNoteFromAnnotation(
  libraryID: number,
  itemKey: string,
): Promise<boolean> {
  const annotationItem = Zotero.Items.getByLibraryAndKey(
    libraryID,
    itemKey,
  ) as Zotero.Item;
  if (!annotationItem) {
    return false;
  }

  const linkTarget = await addon.api.relation.getLinkTargetByAnnotation(
    annotationItem.libraryID,
    annotationItem.key,
  );
  if (linkTarget) {
    const targetItem = Zotero.Items.getByLibraryAndKey(
      linkTarget.toLibID,
      linkTarget.toKey,
    );
    if (targetItem) {
      return true;
    }
  }
  return false;
}

async function createNoteFromAnnotation(
  libraryID: number,
  itemKey: string,
  openMode: "preview" | "builtin" | undefined,
) {
  const annotationItem = Zotero.Items.getByLibraryAndKey(
    libraryID,
    itemKey,
  ) as Zotero.Item;
  if (!annotationItem) {
    return;
  }

  // Check if the annotation has a note link tag
  const annotationTags = annotationItem.getTags().map((_) => _.tag);
  const linkRegex = new RegExp("^zotero://note/(.*)$");
  for (const tag of annotationTags) {
    if (linkRegex.test(tag)) {
      const linkParams = getNoteLinkParams(tag);
      if (linkParams.noteItem && linkParams.noteItem.isNote()) {
        addon.hooks.onOpenNote(linkParams.noteItem.id, openMode || "builtin", {
          lineIndex: linkParams.lineIndex || undefined,
        });
        // Remove deprecated link tag and create a link in IndexedDB
        await addon.api.relation.linkAnnotationToTarget({
          fromLibID: annotationItem.libraryID,
          fromKey: annotationItem.key,
          toLibID: linkParams.libraryID,
          toKey: linkParams.noteKey!,
          url: tag,
        });
        annotationItem.removeTag(tag);
        await annotationItem.saveTx();
        return;
      } else {
        annotationItem.removeTag(tag);
        await annotationItem.saveTx();
      }
    }
  }

  const linkTarget = await addon.api.relation.getLinkTargetByAnnotation(
    annotationItem.libraryID,
    annotationItem.key,
  );
  if (linkTarget) {
    const targetItem = Zotero.Items.getByLibraryAndKey(
      linkTarget.toLibID,
      linkTarget.toKey,
    );
    if (targetItem) {
      addon.hooks.onOpenNote(targetItem.id, openMode || "builtin", {});
      return;
    }
  }

  const note: Zotero.Item = new Zotero.Item("note");
  note.libraryID = annotationItem.libraryID;
  note.parentID = annotationItem.parentItem!.parentID;
  await note.saveTx();

  const renderedTemplate = await addon.api.template.runTemplate(
    "[QuickNoteV5]",
    "annotationItem, topItem, noteItem",
    [annotationItem, annotationItem.parentItem!.parentItem, note],
  );
  await addLineToNote(note, renderedTemplate);

  const tags = annotationItem.getTags();
  for (const tag of tags) {
    note.addTag(tag.tag, tag.type);
  }
  await note.saveTx();

  await addon.api.relation.linkAnnotationToTarget({
    fromLibID: annotationItem.libraryID,
    fromKey: annotationItem.key,
    toLibID: note.libraryID,
    toKey: note.key,
    url: addon.api.convert.note2link(note, { ignore: true })!,
  });

  addon.hooks.onOpenNote(note.id, "builtin", {});
}

async function syncAnnotationNoteTags(
  itemID: number,
  action: "add" | "remove",
  tagData: { tag: string; type: number },
) {
  if (!getPref("annotationNote.enableTagSync")) {
    return;
  }
  const item = Zotero.Items.get(itemID);
  if (!item || (!item.isAnnotation() && !item.isNote())) {
    return;
  }
  let targetItem: Zotero.Item;
  if (item.isAnnotation()) {
    const annotationModel = await addon.api.relation.getLinkTargetByAnnotation(
      item.libraryID,
      item.key,
    );
    if (!annotationModel) {
      return;
    }
    targetItem = Zotero.Items.getByLibraryAndKey(
      annotationModel.toLibID,
      annotationModel.toKey,
    ) as Zotero.Item;
  } else {
    const annotationModel = await addon.api.relation.getAnnotationByLinkTarget(
      item.libraryID,
      item.key,
    );
    if (!annotationModel) {
      return;
    }
    targetItem = Zotero.Items.getByLibraryAndKey(
      annotationModel.fromLibID,
      annotationModel.fromKey,
    ) as Zotero.Item;
  }
  if (!targetItem) {
    return;
  }

  if (action === "add") {
    targetItem.addTag(tagData.tag, tagData.type);
  } else {
    targetItem.removeTag(tagData.tag);
  }

  await targetItem.saveTx();
}
