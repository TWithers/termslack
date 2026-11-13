import { Overlay } from "./Overlay";
import { searchResultHeight } from "./SearchResults";
import type { Popups } from "./usePopups";

/** The help screen, the switcher, the theme picker or the search, whichever is open, over the panes; nothing when none is. */
export function PopupOverlay({
  popups: { help, switcher, themePicker, channelMenu, channelDetails, search },
  columns,
  height,
}: {
  popups: Popups;
  columns: number;
  height: number;
}) {
  if (help.isOpen) {
    return (
      <Overlay
        size="large"
        title="Keyboard shortcuts"
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

  return null;
}
