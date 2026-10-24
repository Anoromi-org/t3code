# Prompt links

A prompt link opens T3 Code with a prompt ready to send. Use one to share a prompt on social
media, or to put a one-click fix in a pull request comment.

A link never runs anything. It opens a draft. You read the prompt, then press Send. A link cannot
change your permission mode, branch, or worktree. Your own defaults apply.

## Make a link

Open the command palette and choose **Copy prompt link**. It copies the draft in the composer.
When the project is on GitHub, **Copy prompt link with repo and model** also adds the repository
and the model you picked. Sent messages have a **Copy prompt link** button too.

You can also write a link by hand:

```
https://app.t3.codes/new?prompt=Rate%20my%20swearing
https://app.t3.codes/new?prompt=Fix%20the%20build&repo=owner/name&provider=codex&model=gpt-5.5
https://app.t3.codes/new?pr=owner/name/123&prompt=Fix%20the%20failing%20check
```

| Parameter  | Meaning                                                                       |
| ---------- | ----------------------------------------------------------------------------- |
| `prompt`   | The prompt. Required, except on pull request links. At most 8,000 characters. |
| `repo`     | A GitHub repository, as `owner/name` or its URL.                              |
| `provider` | A provider such as `codex` or `claude`.                                       |
| `model`    | A model of that provider, by its id or name.                                  |
| `pr`       | A GitHub pull request, as `owner/name/123` or its URL.                        |
| `from`     | The name of the app that made the link. Used with `key`.                      |
| `key`      | A random secret the app keeps (base64url, at least 16 characters).            |
| `ref`      | Where the user was in the app that made the link. See below.                  |

Encode the prompt for a URL. In JavaScript, use `encodeURIComponent`.

## Open a link

On app.t3.codes, the link first asks where to open it: the desktop or mobile app, this browser
when it is connected to a machine, or the download page. Select **Remember my choice** to skip
this step next time.

- **No `repo`**: the draft opens without a project, on the machine you used last.
- **`repo`**: the draft opens in your most recently used project for that repository. A fork
  counts only for its own owner. When you do not have the repository, choose **Clone** or **Use
  without project**.
- **`provider` and `model`**: used when you have that provider set up. Otherwise your default
  model is used, and T3 Code tells you.
- **`pr`**: opens the thread linked to that pull request on any connected machine, with the prompt
  in its composer. When no thread is linked, the draft goes on the pull request branch in a new
  worktree. T3 Code checks the code out only after you confirm, because the checkout runs your
  setup script on it.

A thread link with a prompt, such as `https://app.t3.codes/<environment>/<thread>?prompt=…`,
puts the prompt in that thread's composer. If you already typed a draft there, T3 Code asks
before it replaces it.

T3 Code removes characters you cannot see, such as zero-width and hidden tag characters, because
they can hide instructions for the agent. When a prompt had them, T3 Code warns you that it may be
malicious.

## Attach where the user was in your app

An app can describe where the user was with `ref`, instead of writing a citation into the prompt.
On mobile, it shows up as one chip in front of the prompt. Tap the chip to see the details and
to go back to the app. The agent gets the same details, marked as context, not instructions.

`ref` is URL-encoded JSON:

```json
{
  "title": "LR parsing · Items",
  "url": "learningapps://open/learn-lr-game",
  "details": [
    ["lesson", "3"],
    ["round", "2"],
    ["stack", "E + n"]
  ]
}
```

- `title`: required, at most 120 characters. It is the chip's label.
- `url`: optional link back into your app, with a scheme such as `learningapps:` or `https:`, at
  most 2,048 characters. `javascript:`, `data:`, and `file:` links are refused.
- `details`: optional, at most 12 `[name, value]` pairs of text. Names are at most 40 characters,
  values at most 200.

The chip names your app by `from`. `prompt` becomes optional: a link with only `ref` opens a draft
holding just the chip. A link whose `ref` is not valid JSON or breaks a limit does not open.
Hidden characters in `ref` count toward the hidden-characters warning, like those in the prompt.

```
t3code://threads/<environment>/<thread>?from=Learning&key=<key>&prompt=Why%20is%20this%20a%20shift%3F&ref=%7B%22title%22%3A%22LR%20parsing%20%C2%B7%20Items%22%2C%22url%22%3A%22learningapps%3A%2F%2Fopen%2Flearn-lr-game%22%2C%22details%22%3A%5B%5B%22lesson%22%2C%223%22%5D%2C%5B%22stack%22%2C%22E%20%2B%20n%22%5D%5D%7D
```

In JavaScript, build it with `encodeURIComponent(JSON.stringify(ref))`. The web and desktop apps
show the chip on sent messages but do not add it to a draft yet.

## Trust an app's links

On mobile, a link with `from` and `key` shows **Don't ask again for <app>** next to OK. Choose it
and later links from that app fill the composer and open the keyboard without the notice. A
warning about hidden characters still shows. The phone keeps only a hash of the key. To stop
trusting an app, open **Settings > Trusted link sources** and choose **Remove**.
