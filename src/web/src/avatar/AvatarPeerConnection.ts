import {
  AvatarConnectResponseSchema,
  AvatarPrepareResponseSchema,
  type AvatarConnectionId,
  type AvatarPrepareResponse,
  type SessionId,
} from '@pattern-b/shared';

interface AvatarPeerConnectionOptions {
  onStream: (stream: MediaStream | undefined) => void;
  onTransportLost: () => void;
}

export class AvatarPeerConnection {
  #peer: RTCPeerConnection | undefined;
  #stream: MediaStream | undefined;
  #connectionId: AvatarConnectionId | undefined;
  #generation = 0;
  #playbackEpoch = -1;
  #playbackRevision = 0;
  #videoStallTimer: number | undefined;

  constructor(private readonly options: AvatarPeerConnectionOptions) {}

  async connect(sessionId: SessionId): Promise<AvatarPrepareResponse['clientConfig']> {
    const generation = ++this.#generation;
    this.#closePeer();

    const prepareResponse = await fetch(`/api/sessions/${sessionId}/avatar/prepare`, {
      method: 'POST',
    });
    if (!prepareResponse.ok) throw new Error('Avatar relay is unavailable.');
    const prepared = AvatarPrepareResponseSchema.parse(await prepareResponse.json());
    if (generation !== this.#generation) throw new Error('Avatar connection was canceled.');

    const peer = new RTCPeerConnection({
      iceServers: prepared.iceServers,
      iceTransportPolicy: 'relay',
      bundlePolicy: 'max-bundle',
    });
    this.#peer = peer;
    this.#connectionId = prepared.connectionId;
    this.#stream = new MediaStream();
    this.options.onStream(this.#stream);

    peer.addTransceiver('video', { direction: 'recvonly' });
    peer.addTransceiver('audio', { direction: 'recvonly' });
    peer.ontrack = ({ track }) => {
      if (generation !== this.#generation || !this.#stream) return;
      this.#stream.addTrack(track);
      this.options.onStream(this.#stream);
      if (track.kind === 'video') {
        track.onmute = () => {
          this.#clearVideoStallTimer();
          this.#videoStallTimer = window.setTimeout(
            () => this.#reportTransportLost(generation),
            prepared.clientConfig.videoStallTimeoutMs,
          );
        };
        track.onunmute = () => this.#clearVideoStallTimer();
        track.onended = () => this.#reportTransportLost(generation);
      }
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed') this.#reportTransportLost(generation);
    };
    peer.oniceconnectionstatechange = () => {
      if (peer.iceConnectionState === 'failed') this.#reportTransportLost(generation);
    };

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer, prepared.clientConfig.iceGatheringTimeoutMs);
    if (generation !== this.#generation || !peer.localDescription) {
      throw new Error('Avatar connection was canceled.');
    }

    const connectResponse = await fetch(`/api/sessions/${sessionId}/avatar/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        connectionId: prepared.connectionId,
        offer: { type: 'offer', sdp: peer.localDescription.sdp },
      }),
    });
    if (!connectResponse.ok) throw new Error('Avatar connection failed.');
    const connected = AvatarConnectResponseSchema.parse(await connectResponse.json());
    if (generation !== this.#generation || connected.connectionId !== this.#connectionId) {
      throw new Error('Avatar connection was canceled.');
    }
    await peer.setRemoteDescription(connected.answer);
    return prepared.clientConfig;
  }

  async disconnect(sessionId?: SessionId): Promise<void> {
    ++this.#generation;
    this.#closePeer();
    if (sessionId) {
      await fetch(`/api/sessions/${sessionId}/avatar`, { method: 'DELETE' }).catch(() => undefined);
    }
  }

  stopPlayback(epoch: number): void {
    if (epoch <= this.#playbackEpoch) return;
    this.#playbackEpoch = epoch;
    this.#resetPlayback();
  }

  stopPlaybackImmediately(): void {
    this.#resetPlayback();
  }

  #resetPlayback(): void {
    const peer = this.#peer;
    const generation = this.#generation;
    const playbackRevision = ++this.#playbackRevision;
    if (!peer || !this.#stream) return;

    this.options.onStream(undefined);
    window.setTimeout(() => {
      if (generation !== this.#generation || playbackRevision !== this.#playbackRevision) return;
      const tracks = peer
        .getReceivers()
        .map((receiver) => receiver.track)
        .filter((track): track is MediaStreamTrack => track !== null);
      this.#stream = new MediaStream(tracks);
      this.options.onStream(this.#stream);
    }, 75);
  }

  #reportTransportLost(generation: number): void {
    if (generation !== this.#generation) return;
    ++this.#generation;
    this.#closePeer();
    this.options.onTransportLost();
  }

  #closePeer(): void {
    this.#clearVideoStallTimer();
    const peer = this.#peer;
    this.#peer = undefined;
    this.#connectionId = undefined;
    peer?.getReceivers().forEach((receiver) => receiver.track?.stop());
    if (peer) {
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.oniceconnectionstatechange = null;
      peer.close();
    }
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = undefined;
    this.options.onStream(undefined);
  }

  #clearVideoStallTimer(): void {
    if (this.#videoStallTimer !== undefined) window.clearTimeout(this.#videoStallTimer);
    this.#videoStallTimer = undefined;
  }
}

function waitForIceGathering(peer: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Avatar ICE gathering timed out.'));
    }, timeoutMs);
    const handleStateChange = () => {
      if (peer.iceGatheringState !== 'complete') return;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      peer.removeEventListener('icegatheringstatechange', handleStateChange);
    };
    peer.addEventListener('icegatheringstatechange', handleStateChange);
  });
}
