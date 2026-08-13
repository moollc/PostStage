var state = {
    ideas: [
      { id: "cdrive2", text: "If you can't name the job of the hook, the picture and the ask, the feed will.", part: "body" }
    ],
  post: {
    id: "stage",
    x: 340,
    y: 72,
    title: "Watch it before you ship it",
    hook: "You wouldn't ship a cut you haven't watched.",
    body: "A post has jobs.\n\nThe first line buys one second. The next lines have to pay it back with something a stranger can use today.\n\nIf you can't say what the hook, the picture and the ask each do, the feed will decide for you.",
    cta: "Reply with the one line you would cut first.",
    hashtags: ["craft", "audience"],
    media: [{ name: "stage-still.jpg", type: "image/jpeg", url: "/source/assets/images/stage-still.jpg" }],
    platform: "linkedin",
    genPrompt: "Empty wooden stage, one amber spotlight, no text",
    audience: "a creator who stages a post on their laptop before they open the native app",
    audienceHow: "stated"
  }
};
localStorage.setItem("poststage.v1", JSON.stringify(state));
location.replace("/");
