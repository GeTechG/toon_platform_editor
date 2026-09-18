<script lang="ts" module>
  // One ink-line icon vocabulary for the whole editor: monochrome, 2px stroke,
  // round caps — the same ink line the editor draws with. Paths are
  // on a 24-unit grid.
  export type IconName =
    | 'plus'
    | 'x'
    | 'trash'
    | 'pencil'
    | 'eraser'
    | 'pipette'
    | 'feather'
    | 'pixel'
    | 'mega-eraser'
    | 'gear'
    | 'download'
    | 'send'
    | 'play'
    | 'stop'
    | 'undo'
    | 'redo'
    | 'onion'
    | 'layers'
    | 'eye'
    | 'eye-off'
    | 'chevron-left'
    | 'chevron-right'
    | 'palette'
    | 'edit'
    | 'copy'
    | 'paste'
    | 'merge'
    | 'expand'
    | 'drafts';

  const PATHS: Record<IconName, string> = {
    plus: 'M12 3v18M3 12h18',
    trash:
      'M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3',
    x: 'M6 6l12 12M18 6L6 18',
    pencil:
      'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4',
    eraser:
      'M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21M5.082 11.09l8.828 8.828',
    pipette:
      'M2 22l1-1h3l9-9M3 21v-3l9-9M15 6l3.4-3.4a2.1 2.1 0 0 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4z',
    // A quill: the outline tool that also fills what it encloses.
    feather:
      'M20.5 3.5c-8 1-13 5-15 11l-1.5 5.5M4 20l6-6M20.5 3.5c1 6-1.5 10.5-6 12.5-2.6 1.1-5 1-6.5.5',
    // A 2×2 of cells: the grid the pixel tool snaps to.
    pixel: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    // The eraser silhouette cutting a line in two.
    'mega-eraser': 'M3 12h4M17 12h4M8.5 5.5h7v13h-7z',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
    download: 'M12 3v12M7 10l5 5 5-5M5 20h14',
    send: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z',
    play: 'M8 5.5v13l11-6.5-11-6.5Z',
    undo: 'M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13',
    redo: 'M21 7v6h-6M3 17a9 9 0 0 1 15-6.7L21 13',
    stop: 'M6.5 6.5h11v11h-11Z',
    onion:
      'M12 4C9 8 3 9.5 3 14.6 3 18.8 7 21.6 12 21.6s9-2.8 9-7c0-5.1-6-6.6-9-10.6ZM12 4V2.2M12 4.6c-2 4.4-2.6 8-2.6 11 0 2.9 1 4.8 2.6 6M12 4.6c2 4.4 2.6 8 2.6 11 0 2.9-1 4.8-2.6 6',
    layers: 'M4 7h11v11H4zM8 4h11v11',
    eye: 'M2.2 12S5.7 5.5 12 5.5 21.8 12 21.8 12 18.3 18.5 12 18.5 2.2 12 2.2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'eye-off':
      'M10.7 6.2A9.9 9.9 0 0 1 12 6c6.3 0 9.8 6 9.8 6a17 17 0 0 1-2.5 3.2M6.6 7.6A17 17 0 0 0 2.2 12s3.5 6 9.8 6a9.4 9.4 0 0 0 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18',
    'chevron-left': 'M15 6l-6 6 6 6',
    'chevron-right': 'M9 6l6 6-6 6',
    // A painter's palette with three wells: the saved-palettes list.
    palette:
      'M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8zM8.5 10.5h.01M12.5 6.5h.01M16.5 9.5h.01',
    // Pencil crossed with a ruler: edit the palette itself.
    edit: 'M13 7 8.7 2.7a2.41 2.41 0 0 0-3.4 0L2.7 5.3a2.41 2.41 0 0 0 0 3.4L7 13M8 6l2-2M18 16l2-2M17 11l4.3 4.3c.94.94.94 2.46 0 3.4l-2.6 2.6c-.94.94-2.46.94-3.4 0L11 17M15 5l4 4M3 21l1-4 11-11 3 3-11 11z',
    copy: 'M9 9h11v11H9zM5 15V4h11',
    paste: 'M8 4h8v3H8zM6 6H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1',
    // Two stacked sheets folding into one — the merge of buffer over cell.
    merge: 'M4 5h9v9H4zM11 10h9v9h-9zM13 5v5h-2v4h4v-4',
    expand: 'M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5',
    drafts: 'M3 14h18M3 14l2-8h14l2 8M3 14v5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-5M7 17h.01M11 17h.01',
  };

</script>

<script lang="ts">
  let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={PATHS[name]} />
</svg>
