export interface Artist {
  id: string;
  name: string;
  albumCount: number;
  coverArt?: string;
  starred?: string;
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  year?: number;
  coverArt?: string;
  songCount: number;
  duration: number;
  starred?: string;
  playCount?: number;
  created: string;
}

export interface Song {
  id: string;
  title: string;
  album: string;
  albumId: string;
  artist: string;
  artistId: string;
  track?: number;
  discNumber?: number;
  year?: number;
  duration?: number;
  size?: number;
  bitRate?: number;
  contentType?: string;
  suffix?: string;
  coverArt?: string;
  path?: string;
  starred?: string;
  playCount?: number;
  created: string;
  isVideo: boolean;
  type: string;
  replayGainTrackGain?: number;
  replayGainAlbumGain?: number;
  /** Audio format details (OpenSubsonic names); absent until the server has scanned the file. */
  samplingRate?: number;
  bitDepth?: number;
  channelCount?: number;
  codec?: string;
  lossless?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  owner: string;
  songCount: number;
  duration: number;
  public: boolean;
  created: string;
  changed: string;
  coverArt?: string;
  /** Playlist description — "comment" is the Subsonic API's field name for it. */
  comment?: string;
  entry?: Song[];
}

export interface ArtistIndex {
  name: string;
  artist: Artist[];
}

export interface SearchResult {
  artist: Artist[];
  album: Album[];
  song: Song[];
}

export interface Credentials {
  serverUrl: string;
  username: string;
  password: string;
}
