import type { FC } from "react";
import { AbsoluteFill, Composition } from "remotion";

const HelloScene: FC = () => (
  <AbsoluteFill
    style={{
      backgroundColor: "#0B1220",
      justifyContent: "center",
      alignItems: "center",
    }}
  >
    <h1 style={{ color: "#E6EDF3", fontFamily: "sans-serif", fontSize: 96 }}>
      AI Video Factory
    </h1>
    <p style={{ color: "#8B96A8", fontFamily: "sans-serif", fontSize: 40 }}>
      hello-world render — v0.1
    </p>
  </AbsoluteFill>
);

export const HelloRoot: FC = () => (
  <Composition
    id="hello"
    component={HelloScene}
    durationInFrames={150}
    fps={30}
    width={1920}
    height={1080}
  />
);
