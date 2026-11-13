import { channelDetailsKeyHints } from "./ChannelDetails";
import { channelMenuKeyHints } from "./ChannelMenu";
import { helpKeyHints } from "./Help";
import { Overlay } from "./Overlay";
import { promptFrame } from "./PromptPopup";
import { ReactionPrompt } from "./ReactionPrompt";
import { SectionPrompt } from "./SectionPrompt";
import { searchKeyHints, searchResultHeight } from "./SearchResults";
import { switcherKeyHints } from "./Switcher";
import { themeKeyHints } from "./ThemePicker";
import type { EmojiLookup } from "../../session/emoji";
import type { Popups } from "./usePopups";

/** The help screen, the switcher, the theme picker or the search, whichever is open, over the panes; nothing when none is. */
export function PopupOverlay({
  popups: {
    help,
    switcher,
    themePicker,
    channelMenu,
    channelDetails,
    search,
    reactionPrompt,
    sectionPrompt,
  },
  lookup,
  columns,
  height,
}: {
  popups: Popups;
  lookup: EmojiLookup;
  columns: number;
  height: number;
}) {
  if (help.isOpen) {
    return (
      <Overlay
        size="large"
        title="Keyboard shortcuts"
        keys={helpKeyHints}
        items={help.items}
        start={help.start}
        areaWidth={columns}
        areaHeight={height}
      />
    );
  }

  if (switcher.isOpen) {
    return (
      <Overlay
        size="compact"
        title={switcher.title}
        keys={switcherKeyHints}
        filter={switcher.filter}
        items={switcher.items}
        start={switcher.start}
        selected={switcher.selected}
        areaWidth={columns}
        areaHeight={height}
      />
    );
  }

  if (themePicker.isOpen) {
    return (
      <Overlay
        size="compact"
        title={themePicker.title}
        keys={themeKeyHints}
        filter={themePicker.filter}
        items={themePicker.items}
        start={themePicker.start}
        selected={themePicker.selected}
        areaWidth={columns}
        areaHeight={height}
      />
    );
  }

  if (channelMenu.isOpen) {
    return (
      <Overlay
        size="compact"
        title={channelMenu.title}
        keys={channelMenuKeyHints}
        items={channelMenu.items}
        start={channelMenu.start}
        selected={channelMenu.selected}
        anchor={channelMenu.anchor}
        areaWidth={columns}
        areaHeight={height}
      />
    );
  }

  if (channelDetails.isOpen) {
    return (
      <Overlay
        size="compact"
        title={channelDetails.title}
        keys={channelDetailsKeyHints}
        items={channelDetails.items}
        start={channelDetails.start}
        areaWidth={columns}
        areaHeight={height}
      />
    );
  }

  if (search.isOpen) {
    return (
      <Overlay
        size="large"
        title={search.title}
        keys={searchKeyHints}
        filter={search.filter}
        items={search.items}
        start={search.start}
        selected={search.selected}
        itemHeight={searchResultHeight}
        message={search.message}
        areaWidth={columns}
        areaHeight={height}
      />
    );
  }

  if (reactionPrompt.isOpen) {
    return (
      <ReactionPrompt
        prompt={reactionPrompt}
        lookup={lookup}
        frame={promptFrame(columns, height, reactionPrompt.contentRows)}
      />
    );
  }

  if (sectionPrompt.isOpen) {
    return (
      <SectionPrompt
        prompt={sectionPrompt}
        frame={promptFrame(columns, height, sectionPrompt.contentRows)}
      />
    );
  }

  return null;
}
