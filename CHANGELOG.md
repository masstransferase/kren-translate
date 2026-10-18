# Changelog

This changelog describes KREN for Visual Studio Code.

## Unreleased

## 2.0.0

The first public source release since 1.3.6. The full description of every feature is in the [User Guide](docs/USER_GUIDE.md).

- **License.** From this release, KREN's source code and documentation are licensed under the PolyForm Noncommercial License 1.0.0: free for personal and other noncommercial use; commercial use needs the author's permission. Releases published earlier under the MIT License stay under the MIT License.
- **AI English Tutor.** Build a lesson from a learning map, read it, practice with reviewed answers and hints, and hold a spoken conversation with Standard or Live replies. Stopping a conversation gives a take-home card and a diagnostic report. Speak and rephrase is a coaching mode: say anything, and KREN corrects it and suggests natural ways to say it, with each suggestion in bold blue.
- **More providers.** Language-model features can use Gemini (Free Tier and Paid keys), OpenAI, Anthropic, Groq or Cloudflare Workers AI, chosen per feature in LLM ROUTING. When a provider is overloaded or out of quota, KREN can switch to the next one with a stored key and says so.
- **Speech.** Read Aloud and the tutor speak with Google Cloud Chirp 3 HD, Edge online voices or Windows voices, and fall back to another source when one fails.
- **Check for updates** in the KREN menu checks Python, edge-tts, Handy and VS Code, and the model and voice names KREN depends on.
- **Credentials.** Each key on the Credentials page has an information button that says what the key is for and where to get it.
- **Dependencies** are updated, with no known vulnerabilities at release.
- **Questions open in VS Code's own dialog.** A message that asks you to choose, such as Reset, Default Setting or a Find with several matches, appears in the middle of the window with its choices and Cancel. Progress and failure messages still appear inside the KREN panel.

## 1.99.81

Release candidate for 2.0.0. Its changes are listed under 2.0.0.

## 1.99.80

Release candidate for 2.0.0. Its changes are listed under 2.0.0.

## 1.38.0

- **Practice tells you what to do, not how KREN works.** The paragraph explaining recipes and diagnostics is replaced by what you are about to do: fill in a blank, choose the right word, or write a phrase of your own.
- **A practice item's controls hold their places.** Review, **Hint**, Ask, a speaker and a microphone stay on the left, enabled or disabled as they apply. Back, the position and Next appear on the right once you have answered. Controls no longer move between items.
- **Hint is new and asks the model.** Stuck before you start, press it and a hint appears in the answer box, saying what to attend to without giving you the answer. It is the box's placeholder, so it never becomes your answer.
- **The speaker reads a practice question aloud.** The microphone is a placeholder: the capability is not built yet, and the button is there so the row will not change shape when it arrives.
- **A review reads more clearly.** The correction starts its own block with a blue rule down its edge, what you got right is green, and the correction itself is bold blue. Blue used to mean both, which made it mean neither.
- **The practice card sits on the editor's surface** with the answer box on the panel's, and there is room around the question and the comments.
- **The lesson example panel no longer scrolls sideways.** Nothing in its control row could shrink or wrap, so it overflowed. Its explanations are filled bullets with no blank line above them, and the buttons have room.
- **The disclosure triangles line up again.** Doubling their size in 1.36.0 lifted them, because their rows align on the text baseline and a larger glyph sits lower inside a taller box.

## 1.37.0

- **The conversation is a conversation.** It opens as a full-height drawer instead of competing for whatever space is left under the other sections, and it keeps running while you close it. The transcript fills the height, with a coach strip above the composer carrying the verdict, the target, and back and next.
- **41 situations, grouped, each with the register it calls for.** They have existed in the shared core since the summer and have never been reachable until now. The register is shown and not editable, because it belongs to the situation.
- **Hint, and Skip this one.** Being stuck used to leave you two options: answer, or stop and end the session over one sentence. **A skipped turn is not evidence** and is removed before the diagnosis, before its five-turn floor, and before the next question is written.
- **KREN answers you and teaches inside the answer.** When your meaning does not arrive it asks what you meant, without supplying the sentence. When it does arrive but the English was wrong, it replies using the right wording naturally, unlabelled. When nothing is wrong it reacts as a person does. **And it can say nothing at all** when saying something would interrupt more than it teaches.
- **Silence still records.** A turn KREN passed over in the exchange still carries its correction in the coach strip, so nothing is hidden, only unsaid.

## 1.36.0

- **A diagnosis now knows what your writing was for.** Domain, function, modality, formality and your learner level reach the model, so naturalness is judged against the writing's purpose rather than against English in general. There is no single natural English: a suggestion that improves a note to a colleague can spoil a paper abstract, and one that suits neither is preference. **A setting you have not chosen is left out**, never sent as a placeholder, because a purpose KREN invented is worse than none.
- **Your learner level reaches the model, not only the filter.** It used to be applied afterwards, deleting suggestions the model had already written blind. Suggestions are now pitched to it.
- **Naturalness suggestions are numbered like findings.** The number no longer collides with the first bullet.
- **The diagnostic report's Cancel is now Delete, and asks first.** Its long explanation of Apply moved to the user guide.
- **Practice diagnoses when you ask.** It used to fire by itself when a set ended. **Review again** steps every item, not only the ones you missed, and controls name the set's real size instead of always saying six.
- **Regenerating an example uses the waiting overlay again**, with its cancel inside it.
- **Waiting messages name what is happening.** Analysing a passage announced itself as answering a question, because it had no state of its own.
- **The lesson example's tools and its back and next sit on one row**, with position and navigation grouped at the right. Fold triangles are twice the size. Score bars share one width beside their labels, and missed items use filled bullets with no gap.

## 1.35.0

- **The lesson shows one example at a time, with next and back**, and states the pattern above it. The explanation no longer folds, the six tool buttons sit on the example you are reading, and **Cancel stays reachable on a regenerating example wherever you have paged to.** A warning belonging to another example is still shown, named by its number, so paging cannot hide one.
- **A lesson drafted from a diagnosis teaches the rule, not the words you got wrong.** The tailored prompt was built from the exact phrases you mistyped, so the whole lesson optimised toward them, which is why regenerating a single example already behaved and redrafting did not. **Those phrases are now withheld from the request** rather than merely discouraged, and at most one example may reuse anything the diagnosis quoted.
- **Practice can run at all again.** Every set was rejected for omitting an answer key that its own request never had a field for. A practice set has no answer key: each answer is marked by its own review.
- **Naturalness reaches every learner level.** It was withheld below Intermediate on the theory that errors come first. Learning natural expression from the beginning is the point.
- **The answer key is no longer a setting.** Turning on Include practice brings **Show answers** with it, in the practice section, because practice without answers is not usable.
- **The report's two lists share one left edge**, and Primary and Support are bold.

## 1.34.0

- **A practice set ends in something.** It used to stop on the last item with no score, no pattern and no record of which target you kept missing. It now ends in results: the score, a bar for each target so you can see which one you kept missing, the missed items with their corrections, and **Walk** stepping only those. Finishing a set also asks for a diagnosis automatically, into the same drawer with the same **Apply**, so a bad run on articles becomes the next lesson. **The results draw before that request and survive its failure**, so a dead network costs the report and never the score.
- **A spelling slip is corrected and listed, and never picks your next lesson.** It carries no learning-map target, never becomes the Primary, and is dropped first when findings compete for the five places. A typo is a keystroke, not a gap in your English.
- **Naturalness can now choose what you learn next.** The Primary target used to come only from a finding, and a finding is always an error, so every lesson drafted after a diagnosis taught correctness and never expression. A naturalness suggestion can now propose the Primary, including when nothing is wrong at all.
- **A lesson teaches the range of its target, not one phrase six times.** No more than two examples may annotate the same phrase, and the drafting request now states that rule, after a lesson on confusable words taught `native speakers` in four of its six examples.

## 1.33.0

- **Naturalness suggestions can arrive at all.** Retiring the third finding level in 1.32.0 was necessary and was not sufficient. The request that names the report's JSON fields listed four of them and `polish` was not among them, so the model was told naturalness had nowhere to go. The same sentence had also asked for a level range of one to four through three releases that each changed how many levels exist, because nothing compared it with the protocol. A test now derives that range from the protocol itself.
- **The lesson is something you read.** Six sentences stay listed as the lesson's spine, and explanations open one at a time behind a disclosure, so short sentences are no longer pushed apart by the long prose about them. The six tool buttons live in the opened example, replacing thirty-six controls in a narrow column with six. **Cancel stays reachable on a regenerating example whichever one is open.**
- **Concept and rules starts closed**, since it is read once and then sits between you and the examples on every later visit.
- **Common errors, practice and the answer key fold and carry counts.** The answer text is absent from the page until you choose Show answers, rather than present and hidden, so folding never became a way to read it early.
- **The report's lists line up.** Findings numbers sit with the report's paragraphs, and the evidence, correction and target bullets are filled circles pulled back to align with Primary and Support.

## 1.32.0

- **Naturalness suggestions can actually appear.** The protocol asked for the same thing twice: findings offered a level meaning `correct but unidiomatic`, and the naturalness list asked for `English that is already correct`. One case with two homes, and the model chose findings every time, which is why a whole validation round produced no suggestion at all. **A finding is now always an error.** Wording that is grammatical but unidiomatic, clumsy, or not what a native speaker would choose is a naturalness suggestion.
- **A finding takes fewer lines.** Findings are numbered, the level label now follows the quoted evidence in parentheses instead of taking a line of its own, and evidence, correction and target sit in one bullet list with nothing between them. Naturalness suggestions read the same way.
- **View diagnostic report is a document icon**, not the copy glyph it borrowed, which read as a copy-and-paste control rather than as a report to reopen.
- **The protocol version no longer shows in the report.** It stays on the report's data, where anything that outlives a session can still read it.
- **The empty panel says what to do.** It named one route, selecting a primary target, and did not say where to find it. It now names the learning map, a typed question, and a passage selected in the editor.

## 1.31.0

- **A report you kept can be reopened after you draft a lesson.** Moving the reopen button into the search row put it inside Learning map, which closes itself as soon as a lesson exists, so **Back to tutor** was keeping a report you could no longer reach. Learning map now stays open while a report is waiting.
- **The search row's own test counts what the layout counts.** It counted controls while the layout counts children, so any other element added to that row would have pushed Clear onto a second line with every test still passing.
- **The design documents stop describing a fourth kind of finding**, which moved into the naturalness list two releases ago.

## 1.30.0

- **A finding says what it means.** It used to say `Level 2`, which told you a number and nothing else. It now names what is wrong with the sentence.
- **Naturalness has its own section: what a native speaker would more likely say, and why.** It is separate from findings on purpose. Accuracy is capped at five, so when your writing has real errors a shared list would have crowded every suggestion out, which is why you never saw one before.
- **Cancel and Back to tutor both belong, because they do different things.** Cancel discards the report. Back to tutor keeps it, so you can reopen it from the search row.
- **View diagnostic report joined the search row**, so the box and all five controls sit on one line, and the row now works out its own width rather than assuming five.

## 1.29.0

- **Two or three Primary targets now actually draft a lesson.** In 1.28.0 you could select them and drafting returned a wall of identical errors, because KREN checked every Primary while telling the model about only the first. It now names them all and asks for what it checks.
- **A Hub or a Cluster may only be the sole Primary.** Exploring a hub is the lesson; combining targets means combining exact ones. The reason is the lesson's own shape: it names one chosen target, so a second hub has nowhere to say which child it picked.
- **Twelve copies of one message became one message and a count.** Any validation failure touching several examples used to print itself once per example.
- **The control that sends a Primary back to Support draws an S**, matching the P beside it, instead of a back arrow that said only "backwards".

## 1.28.0

- **You can hold up to three Primary targets at once.** Setting one used to quietly demote whichever Primary you already had, so however many you chose you ended up with one. They are now added, and taught together when they can sit in one sentence, which the compatibility check decides as it always did. Three is the ceiling because every Primary obliges every example, and a fourth turns six examples into a puzzle no model reliably solves.
- **A Primary can be demoted back to Support**, which matters now that promoting something else is no longer a way out of Primary.
- **A limit no longer breaks the button row.** When you have reached three Supports the control is absent rather than sitting there disabled with a reason printed underneath it, and the limit is stated once in the Selected targets panel.

## 1.27.0

- **A tailored prompt keeps governing after you change a target.** It used to name the targets it was written with, so changing the Primary afterwards left the prompt asking for one thing and the recipe for another, and the lesson followed the recipe. The prompt now carries only what the diagnosis found. **The prompt says what to teach about; the selected targets say which targets to teach it through.** A changed selection changes the constraints, never the objective.
- **A finding says what would be right, not only what is wrong.** Where your quoted words need correcting, the correction sits beside them. It is omitted rather than invented: a correction that changes nothing is not shown, and a finding about register carries none, because that is a suggestion rather than a fix.
- **The footnote under Selected targets stays while a tailored prompt does**, and says which analysis the targets came from, a passage or a conversation.
- **One ready-to-draft line instead of two** that said much the same thing.
- **A report proposing no targets offers Cancel and no Apply**, because there is nothing to apply.

## 1.26.0

- **One diagnostic protocol, shared by every analysis.** The sweep through the learning map's own hubs, what counts as worth reporting, how a finding is phrased, and which map node it is filed against are now one constant sent with every diagnosis, instead of two prose instructions that agreed by coincidence. A test asserts the constant matches the document it was copied from, so the two cannot drift apart.
- **A fourth level of finding: correct English that sits below what your own purpose calls for.** Register, where the formality does not match the situation, and precision, where a more exact word carries more information. It needs a mismatch visible in what you wrote, it is capped at one per report, it is reported last, it is never the primary target, and it does not appear below Intermediate. A difference that is only preference is still never reported.
- **Your conversation can now be diagnosed.** After five completed turns, KREN reads the transcript and produces the same report a passage produces, into the same drawer, with the same Apply. Findings say how many turns they appeared in, and a pattern outranks a single slip.
- **What the diagnosis is shown, and what it is not.** Each turn's question, your answer and KREN's correction. **Not KREN's own explanations**, deliberately: diagnosing from KREN's earlier reasoning about you produces agreement with KREN rather than a look at you. Evidence is checked against your answers alone.

## 1.25.0

- **A passage analysis now gives you a report, not just targets.** Weakness and Text analysis return a summary, up to five findings each quoting a phrase from your own writing, and a paragraph on what a lesson should work on next. Every quotation is checked against your passage before you see it, and a finding whose evidence KREN cannot find is dropped, because an invented quotation reads as something you wrote.
- **Reading the report changes nothing.** The analysis proposes targets; **Apply** commits them. Dismissing the report leaves the tutor exactly as it was.
- **Apply leaves KREN ready to draft.** It fills Selected targets, then asks a model to write a tailored prompt from the report, and loads that prompt where you can edit it. Drafting a lesson or practice then carries it, so what you get is about what your writing actually showed.
- **A failed prompt request does not cost you the apply.** The targets stay applied and KREN assembles its own prompt from the report, saying plainly that it wrote it rather than the model.
- **The message under Selected targets reads as a footnote**, not as a warning.
- **The conversation turn card drops its Next question line**, which repeated the live question above the answer box.

## 1.24.0

- **The search box and its four controls sit on one row.** The row declared four columns for five children, so Clear wrapped onto a line of its own. Its test now derives the column count from the number of controls, so a sixth one cannot reintroduce the same defect.
- **A phrase explained three ways appears once, not three times.** Explanations for the same target phrase now share one paragraph, in the order they arrived, and none is dropped.
- **Learner levels read as words:** Beginner, Elementary, Intermediate, Upper-intermediate, Advanced and Proficient, with Auto unchanged. The stored value and what the model receives are still the framework codes, because a model has a far more precise notion of B2 than of a word that means different things to different teachers.
- **A typed conversation practice**, the first half of the oral-practice prototype. KREN asks, you type, KREN corrects the answer, files the correction against a learning-map target, explains it and asks the next question, until you stop. Stopping cancels a request already in flight, so a late answer never lands in a transcript you have closed.

## 1.23.0

- **Ask with an empty box now diagnoses the passage you selected in the editor.** KREN asks which analysis you want, weakness or text, showing the exact passage it will send, and fills Selected targets from the answer. Weakness analysis looks for where the writing is weak across the whole learning map; text analysis identifies which learning-map items the passage uses, whether or not anything is wrong.
- **Nothing happens without a passage.** With no editor selection, or more than one, KREN says so and contacts no model. Dismissing the question sends nothing and changes nothing.
- **Your passage chooses the targets and is not kept.** It is not stored, not put in the recipe, and not used to seed examples, so a lesson never quotes your own writing back at you unless you ask for that.
- **What the confirmation shows you and what is sent are one value**, not two that happen to match, so they cannot drift apart in a later change.

## 1.22.0

- **The prepared lesson prompt has its own button on the action row**, between Ask and Clear, drawn as an icon like its neighbours. It is greyed when there is no prompt to show, and it no longer disappears once a lesson or practice set exists.
- **The prompt is editable, and your edit reaches the model.** It is added to the request rather than replacing it, so the privacy sentence, the response shape and the recipe data all still go with it.
- **An edit does not survive a change to the recipe.** Change a target, the question, or any setting that feeds the prompt, and the prompt is rebuilt and your edit dropped, with a notice above the box saying so rather than swapping the text silently.
- **The Learning Map information buttons and the Selected targets row buttons are a fifth smaller**, 21 and 24 pixels, while their glyphs stay 18 pixels. A test now enumerates every rule that sizes an icon glyph and requires each to be 18, because the previous test only checked the intended rule was present and a more specific rule beside it shrank the glyph with the suite still green.

## 1.21.0

- **The Learning Map is open when you arrive**, with Lesson, Setting and Review recipe folded. Once you fold or unfold something yourself that choice stands, and generating a lesson still folds everything and scrolls to the result.
- **"Use model to find learning-map targets" is gone.** Find now always uses the local ranker and contacts no model, which is the split it always looked like it had: Find is fast and local, Ask is smart and remote.
- **"Use question without learning-map targets" now sits under the Learning Map**, below the box where you type a target name or a question, which is where you are deciding it.
- **The Selected targets panel no longer shows a Primary the lesson never uses.** With question-only on, Ask stored the model's Primary while the recipe quietly demoted it to a support, so the panel and the request disagreed. The demotion now happens where the selection is stored, on every path.

## 1.20.0

- **Practice shows one item at a time.** A set of ten was a wall to scroll through; now the current item stands alone, with back and next arrows beside the Ask control once you have reviewed it. Back is absent on the first item and next on the last, rather than present and dead.
- **Going back shows what you left there**: your typed answer, the review, and an active Ask button. Nothing is requested again, and moving between items makes no model call at all.
- **A new practice set starts at its first item**, and a position can never point past the end of the set it belongs to.

## 1.19.0

- **The prepared lesson prompt opens in its own screen** rather than sitting in the page and pushing everything below it down. View prepared lesson prompt opens it, Back to tutor closes it, and it is independent of the Dictionary and Translate drawers, so opening one does not disturb the other.
- **The Selected targets heading has room beneath it, and its three controls stay on one line.** Set as primary, Add as support and Clear all no longer drop onto a line of their own.
- **Every icon button inside the tutor is a white icon on the button background**, including the per-example controls that 1.18.0 left alone. The KREN header keeps its own styling, and a test now reads every rule that paints an icon button and requires each one to be tutor-scoped, because the previous test only checked that the scoped rule existed and a second unscoped rule beside it would have repainted the header with the suite still green.

## 1.18.0

- **A dictionary lookup no longer destroys the sentence it came from.** Highlighting a word replaced the box contents with that word, so the sentence was gone and a second word could not be picked from it. A Restore sentence control beside Look up puts it back, and the result now has room beneath the button instead of sitting against it.
- **The exercise channel reads Display-based rather than Written**, which was being mistaken for the Channel setting in Rewrite Text. Only the label changed; the stored value the model receives is still `written`, and a test now holds those two apart so a later reader cannot confuse them.
- **A generated lesson or practice set folds the panels above it and scrolls itself into view**, so you are looking at what you just made. It happens once per generation, and never on a failure, a cancellation, or a later redraw, so it cannot pull you away from somewhere you scrolled yourself.
- **Every Ask shows the same waiting notice the other long actions show**, and clears it on success, on failure, and on cancellation. All three Ask paths were silent while they worked.
- **The search box keeps what you typed**, and gains a Clear control beside Ask. Clear empties that box and nothing else: not the selection, not the question, not the lesson, because Reset already does that.
- **Find, Ask, Clear, and the Ask on a reviewed practice item are drawn as actions**, a white icon on the panel's button background, matching Review. They read as decoration before.

## 1.9.1

- **A practice review now holds the standard Grammar Check holds.** Grammar Check knows that phrasing is wrong when a native speaker would not say it, and that a sentence with no grammatical error can still be wrong that way. The tutor's review knew only how to mark spans, so it told a learner their unnatural sentence was fine. The two now read that standard from one place in shared core, so a change to it reaches both.
- **A redraft no longer fails on `supportTargetUnderused` until it happens to succeed.** Core requires each support target in at least two examples and the instruction never mentioned support targets at all, so the model satisfied it by luck. It now names each support identifier and the requirement, taken from the recipe so it cannot drift from what validation checks.
- **The Dictionary opens on the phrase the example teaches**, its annotated excerpt, rather than empty or prefilled with the whole sentence. Translate keeps the sentence and gains an output-language control for that lookup, defaulting to your Translation setting and never writing it.
- **A lesson with practice offers Show answers**, hidden until asked for and absent when there is no answer key.
- Presentation: the promote control uses a P icon, the lesson's section title is upper case, the per-example Dictionary and Translate controls are icons, example and practice text is set at the size of the explanation around it, and the target search field is resizable.
- **Two tests stopped depending on how the repository was checked out.** They sliced source on a literal newline, so a CRLF checkout made the slice overrun its function and count things from the rest of the file. They passed here only because these files happened to be LF on this machine.

## 1.9.0

- **The search finds targets from what you mean, not only from what you typed.** Pressing Enter runs a ranked match over every node's label, description, and example sentence, and offers each of the best three in turn: primary, support, or skip. Typing still filters as before, because a search that pauses to think on every keystroke is a worse control than one that filters as you type. `vs`, `vs.`, and `versus` are separators rather than search terms, so `gerund vs infinitive` finds that contrast instead of hunting for the word versus.
- **A plural query finds a singular label.** Matching was a plain substring test, which works one way only, so `articles` returned nothing at all while the node named *A/an, the, and zero article* sat in the map. That is the most ordinary query a learner could type.
- **Two supports may come from one cluster.** The limit was a heuristic dressed as a rule. One primary is real, because a lesson teaches one thing, and a cap on supports is real, because too many equal objectives make shallow explanations. Variety within a cluster is a judgement the reader makes better than KREN can.
- **The Dictionary tool works.** Its drawer was prefilled with the whole example sentence while the dictionary accepts eight words, so every lookup was refused. Translate keeps the sentence; Dictionary opens empty.
- **The Review button becomes available as you type.** Its state was computed when the page was drawn, and the page deliberately does not redraw while you type, because redrawing would take your cursor with it.
- The lesson result folds Concept through Rules and tendencies into one section, drops the repeated learner level and the per-example target list, marks annotated excerpts in bold rather than underlined, and gives each example icon controls with accessible names.

## 1.8.5

- **One lesson control, relabelled by what it will do.** Draft lesson and a second Redraft lesson button stood side by side sending the identical command, so the pair could only be read as two different actions. The single button now reads Redraft lesson once a lesson exists, which is how Practice now and Practice again already worked.
- **Reset returns the tutor page to how it opened.** It asks first, in a dialog naming what goes, then clears the drafted lesson, the practice set with its answers and reviews, every selected target, and all four learning-map dropdowns. Lesson, style, and provider settings are kept. It is unavailable on an untouched page and while a request is in flight.
- **Clear all rewinds the four dropdowns as well as the tray.** It cleared only the tray, leaving the cascade showing the path of a target that was no longer selected and Set as primary still offering the target just removed.
- **The information button sits before the level name** it belongs to, at Hub, Cluster, Skill, and Micro-target alike.
- **A disabled button's label is readable.** The disabled treatment swapped in the secondary background and kept `--vscode-button-foreground`, which is near white in every light theme. Review is rendered disabled until an answer is typed, and its label was invisible for exactly that long.
- **Examples and practice items carry a number and the sentence.** The heading was the model's own identifier, `ex-1`, with the sentence in a paragraph below it, so the first thing on every example was a label written for the transport. Generated practice is headed Practice rather than The Exercises.
- **Lesson list markers sit on the left edge**, level with the Rules and tendencies heading above them, instead of under the browser's default list indent.

## 1.8.4

- **The lesson request states only the branch that applies.** The instruction carried both Explore and Exact and asked the model to tell them apart from the supplied identifier. It cannot: the recipe holds an identifier and nothing saying whether it names a Hub or a Skill. So it guessed Explore for an exact target, invented a child, and every example named something the recipe never asked for, which is one `exploreChoiceUnexpected` and one `primaryTargetMissing` per example. KREN has the map, so KREN decides, and for a Hub it now lists the exact identifiers that may be chosen.
- **A new test asks whether KREN's own prompt can be answered at all.** A lesson and an exercise set were written by hand against the exact prompt KREN sends, obeying every constraint in it, and put through the same validators a real reply faces. Both are accepted. Nothing in the suite covered that before: every other test builds a reply and checks the validator, or builds a request and checks the words, and none joined the two ends.
- **Draft lesson and Practice now sit on the heading line**, and Set as primary and Add as support sit beside Clear all.
- **The information button stays transparent after a selection.** `button.secondary` at specificity 0-1-1 beat `.tutor-map-information` at 0-1-0 despite appearing earlier, and the `aria-disabled` attribute present before a selection was raising the tutor rule just enough to hide it. Choosing an option removed that attribute and exposed the fill. Fixed by qualifying the selector rather than with `!important`.

## 1.8.3

- **Gemini is sent no response schema, and 1.8.2's addition of one is withdrawn.** Sending a schema returned 400 on every attempt. Gemini's schema subset has two separate incompatibilities here: it rejects `additionalProperties`, which every schema sets for OpenAI's strict mode, and it accepts `enum` only on a string, while `schemaVersion` is a numeric const that has to become an enum to be expressed at all. Removing the first left the second.
- **The real fix from 1.8.2 stays and is what was needed all along.** The instruction claimed to state the response shape and did not, so Gemini invented field names. It now carries the shape, derived from the schema so it cannot drift, and prose cannot be rejected by a provider.
- **A rejected request reports what the provider said**, not only its status. *"failed (400)"* was on screen twice while the cause was one unsupported keyword in a request the reader could not see. The provider's message is included, bounded, and the status still survives a body that cannot be read.
- **Draft lesson and Practice now**, replacing Generate lesson and Generate exercises, with Redraft lesson and Practice again beside them and the notices, guide, and blueprint brought into one voice.
- **The four buttons share one width**, derived rather than measured, so a later wording change cannot silently break the alignment.
- **The information button has no background** in any state, and keeps its focus indicator.
- Fourteen mutations run across the two changes. Three survived and are now covered, including the provider-error text having had no test at all.

## 1.8.2

- **The tutor can generate at all.** Gemini was never told what shape to return. The transport deliberately sent no schema, because Gemini rejects `additionalProperties` and every schema here sets it for OpenAI's strict mode, and the comment recording that said the instruction stated the shape instead. It did not: the tutor's instruction said "matching the KREN TutorLesson contract" and named no field, so Gemini invented plausible names and validation refused every one. **The tutor's default provider is Gemini, so it had never worked with the settings it ships with.**
- Gemini now receives the shape twice: a sanitised schema with exactly what it rejects removed, and the same shape stated in words as the fallback if a model rejects the schema for another reason. Both are derived from the one schema object, so neither can drift from it.
- **Exercise sets echo the right values.** The instruction named where to look, "the recipe mapVersion, requested written channel", rather than what to write. It now states them as literals taken from the request, so they cannot disagree with what validation compares against.
- **The redundant Cancel beside Generate lesson is gone.** The waiting overlay carries its own, and while the overlay is up the one behind it cannot be reached.
- **Generate exercises stays visible while exercises generate**, disabled with its reason, instead of being replaced by a Cancel button at the moment the reader is looking at it.
- **The information control draws an information icon**, a lower-case i inside a circle, added to shared core for it. It drew the `menu` hamburger, which was the closest glyph that existed.
- **Generate lesson, Generate exercises, Set as primary, and Add as support are right-aligned.**
- Fifteen mutations were run across the two changes. Three survived and are now covered, including a hard-coded map version that passed only because the current version happens to be the literal it was replaced with.

## 1.8.1

- **Generating a lesson or exercises no longer fails.** Every attempt reported *AI English Tutor received a malformed lesson*. The validator read each example's `sentence`, `targetIds`, and `annotations` without checking they existed, so a model omitting one field threw, and four catch blocks discarded the error and threw a fixed sentence, which is why the message never said anything useful. Fixed in shared core 0.14.5, and each of the four now names the cause and writes it to the KREN output channel.
- **The learning map is laid out like every other settings panel**, one row per level with its name, a short description, and the control. Each of Hub, Cluster, Skill, and Micro-target carries a sentence saying what it is.
- **The search field loses its label and matches the dropdowns' height**, and choosing a result now closes the result list. Previously the list stayed open and the only way to dismiss it was to clear the typed text.
- **Information controls are icons beside each level's name**, not the letter `i` beside its dropdown. A selected target's row ends with a waste-basket icon, and the clearing control is `Clear all` at the bottom right.
- **Replacing a primary target asks first**, offering Set as primary, Add as support, or Cancel, and states whether the previous primary will become a support or be cleared. It offers Add as support only where the limits leave room, and says why when they do not.
- **Three support targets no longer make the primary impossible to change.** The limits blocked the replacement outright, which is the opposite of what they are for; the choice above already states and delivers the outcome.
- **The waiting overlay carries its own Cancel.** It covers the page, so a generation that hung left every control unreachable, including the Cancel that already existed underneath it.
- Six explanatory sentences removed as noise, one of which was also wrong: the already-selected reasons appeared for targets that were not selected.
- The verifying run found that **five of six named tests still passed after the behaviour they guarded was deleted**, and proved four defects with probes. All four are fixed. Five further mutations were run here; one survived and is now covered.

## 1.8.0

- **The AI English Tutor page is restructured.** Four foldable parents, LEARNING MAP, LESSON, SETTING, and REVIEW RECIPE, with the five style axis groups and LLM ROUTING nested inside SETTING, and the exercise settings under LESSON while the generated items render below the lesson.
- **The learning map is four cascading dropdowns**, not a tree. A tree's fourth level left its most useful items a third of a 380-pixel sidebar to be read in. The selection lives in a **Selected targets** list showing each target's full path and its role, an information button beside each dropdown carries the target's detail, and a search field fills all four levels from one result.
- **Zero primary targets is a valid intermediate state.** Nothing warns and nothing is undone; generation is disabled with the visible reason. Two confirmation dialogs were specified for this and both were dropped, because a modal costs most while the reader is still exploring and the state it guarded is not an error.
- **Selecting a Hub or a Cluster means Explore**, so KREN chooses an eligible child beneath it, teaches that child, and names it. The lesson header reads *chosen for you under* the parent, so a reader is never taught something other than what they picked without being told. This needed shared core 0.14.4, which validates the choice: a lesson that ignores it, picks a child from elsewhere, or claims a choice it was never offered is rejected with its own code.
- Explore is decided by the kind of node, not by whether it has children. A Skill carrying micro-targets beneath it is still an exact target.
- Nineteen mutations were run across the two repositories, including three red probes. Three fixture defects were found where an assertion was correct and could not fail, one of them the same defect that discarded the reader's support targets in 1.6.0.

## 1.7.13

- **Immediate result ships as Hover over the selection.** 1.7.12 had adopted the owner's own value, Open this panel, along with every other default. Once the setting's scope was described honestly the owner tested the three values against a Dictionary result rather than a rewrite, saw the difference, and chose Hover as the shipped default. Request timeout keeps the 30 seconds adopted in 1.7.12.

## 1.7.12

- **Ignore all on a grammar result**, beside Open full details, at the owner's request. It dismisses the whole check at once, dropping the stored result, the hover card, and the editor's Quick Fix entries together, then leaves the panel on the Start page rather than on an empty result screen. A clean result carries neither control, because it has nothing to open and nothing to ignore. Nothing is stored, so a term KREN should stop reporting still belongs in the local vocabulary.
- **Immediate result never applied to Rewrite Text or Grammar Check**, and its description said otherwise. Both always open the panel, because a rewrite carries two variants and a grammar result carries a control per finding, and neither fits a hover card. The setting and the guide now say which features it governs, which is why the owner saw no difference testing it with Minimal Rewrite.
- **The defaults are the settings the owner is running.** Immediate result now ships as **Open this panel** and Request timeout as **30 seconds**, replacing Hover and 45 seconds. The recorded default set is updated in the same commit, so neither moved unnoticed.
- Eight mutations were run against the new behaviour. One survived and was a fixture defect rather than a missing assertion: the test's clear stub did not call the panel's own clear, which is what resets the screen, so the ordering the whole feature depends on was unobservable. The stub now does what the extension wires it to do, and all eight are caught.

## 1.7.11

- **The four settings that had no control now have one.** They were reachable only through VS Code's own settings screen, and the panel's route to that screen went with the button renamed to Reset KREN in 1.7.8, so for three versions they could not be reached from KREN at all. **Immediate result** and **Request timeout** sit above the API keys under Credentials and Usage, **Maximum characters** is in Translation, and **Maximum entries per import** is in User Dictionary.
- The timeout is shown in **seconds** and stored in milliseconds, so nothing downstream changes. The division and the multiplication sit beside each other, marked by one attribute, rather than being remembered at each end.
- **`kren.rewrite.preferredVariant` is removed.** It had been inert since the panel began showing Minimal Rewrite and Full Rewrite together, and its own control said so. A value stored in any scope is cleared at activation rather than rewritten, because there is no value left that KREN would understand.
- **Translation and Explain gain a Domain**, the same eight subject areas Rewrite Text offers, read from the one shared list so a subject area means the same thing whichever feature asked for it. General is the default and adds nothing to the prompt. It reaches all three language-model providers from one edit, because they share one system instruction.
- **Google Cloud Translation cannot take a subject area.** Basic v2 accepts a text, a source, a target, and a format, and has no domain, glossary, or model parameter, so under that provider the Domain control is shown dimmed with the reason beside it and the stored choice is kept for when a language model is selected again.
- Fifteen mutations were run against the new guards. All fifteen were caught.

## 1.7.10

- **The result text is the size of the input text.** It was set at 1.15rem against the input's .95rem, which read as unnecessarily large beside everything else on the card. The two are read against each other, so they are now set together and a test reads both rules rather than pinning a number.
- **Copy, Replace selection, and Open full details, in that order**, with Copy and Replace drawn as the icons a Rewrite Text variant already uses. Dictionary and thesaurus results keep their text buttons: Copy is the only control on that row, so an icon there would be a bare glyph with nothing to read it against.
- **The same-language warning is one line**, *Input and output languages are identical*, and it appears on a translation only. It fired on every explanation in 1.7.9: Explanation language defaults to Same as source, so the two matching is the intended case there, and the result carried nothing that let the panel tell a translation from an explanation.
- A translation result now records which operation produced it. Two mutation probes that deleted that field from a provider passed the whole suite before this, because every panel test built its result by hand, so the warning would have gone silently dead. The suite now runs a real translation and a real explanation through their providers and reads what comes back.
- Seven mutations were run against the new guards. All seven were caught.

## 1.7.9

- **Model discovery keeps every Gemini text model the key can reach, Flash included.** The normalizer kept only ids carrying `pro`, written when the one Refresh button belonged to the alternate profile and that profile meant Pro. Both profiles have shared the discovered list since 1.7.7, so the filter was quietly deleting every Flash model from a list the Default profile reads, which is why Gemini 3.7 Flash never appeared. Speech, image, video, embedding, and computer-use models are still excluded, because they advertise the same method and cannot answer a KREN prompt.
- **Persian (Farsi) is offered wherever KREN offers a language**, from core 0.14.3. The two voices are what `edge_tts.list_voices()` publishes for `fa-IR`, read from the runtime rather than written from memory.
- **Explain follows the explanation language rather than the English-to-Korean direction.** Under Same as source the equivalent target read `analysis.targetLanguage`, which sends everything that is not Korean to Korean, so English text produced a Korean equivalent beside an English note. When the explanation language is the language the text is already in, KREN now asks for a plain restatement.
- **`languageName` resolves a locale id.** It knew only bare codes, so a locale chosen from the lists added in 1.7.7 reached the prompt as a literal: "give a natural en-US equivalent". This is why English behaved differently from every other language.
- **The translation Output language has no Auto and defaults to Korean.** An output that changed with the input was a second detection the reader could not see on the control. The case it avoided is now visible: **when input and output are the same language the result carries a warning** saying KREN restated the text rather than translating it. A stored `auto-en-ko` is migrated to Korean at activation and read as Korean in the meantime, so nobody meets an error for a value KREN wrote itself. The migration that used to write `auto-en-ko` is deleted rather than left dormant, because it would still fire on a fresh install.
- **Default Setting confirms twice**, like Reset KREN, and its second confirmation counts how many settings have been changed.
- **KREN's declared defaults are now the settings this build was configured with**, so Default Setting returns it to a working state. They are pinned as one set in `test/declaredDefaults.test.ts`: a default may move at any time, but not unnoticed, and a new setting fails until its default is recorded.
- Eighteen mutations were run against the new guards across both repositories. All eighteen were caught.

## 1.7.8

- **The Model list shows every discovered model.** It was a text field backed by a `<datalist>`, and a datalist filters its options against whatever is already typed in the field, so with a full model id in the box exactly one suggestion survived. Nine models were in the markup and unreachable. It is now a select, which cannot filter itself away, with the editable identifier field kept below it so a model the list has not got is still reachable by typing it.
- **Bilingual English and Korean explanations were removed.** Explanation language now opens with Same as source, which is also the new default, followed by the twenty languages Read Aloud offers. A stored `bilingual` becomes Same as source once, at activation, in every configuration scope. The selected text may be in any language; only the note follows this setting.
- **Translation has an Input language and an Output language**, both drawn from the same catalog Read Aloud uses. Input defaults to Auto-detect, which decides from the text on the same evidence Read Aloud uses and passes `auto` through when the evidence is thin. Every request went out marked `auto` before this, whatever was chosen, because there was nothing to choose. The decision is made above the provider split, so the Cloud Translation path, the language-model path, and the Merriam-Webster multi-word fallback all use it.
- **Two reset actions under Credentials and Usage.** **Default Setting** returns every KREN setting to the value the extension declares and touches nothing else, confirming once. **Reset KREN**, which replaces the button previously labelled All KREN settings, also deletes every stored API key, clears provider consent and the Cloud Translation usage ledger, and empties the local grammar vocabulary; it confirms twice, and the second confirmation names how many keys are about to go. Both remove each stored override rather than writing today's default into it, so a later change to a default still reaches the reader.
- VS Code's own settings screen is now reached from the Command Palette with Preferences: Open Settings rather than from that button.
- Sixteen mutations were run against the new guards, deleting each guarded behaviour and confirming a named test fails. All sixteen were caught.

## 1.7.7

- **Each Gemini profile now stores its own model.** Default and Alternate shared one `<feature>.model` setting, so choosing a model under one overwrote the other's. Every feature gains a second setting, `<feature>.alternateModel`, and the panel draws one Model control per profile, showing the one that matches the Gemini profile selected above it. OpenAI and Anthropic use the Default profile's control, because they have no profile of their own.
- **Refresh reads the key of the profile whose control it sits beside.** One command queried the alternate key whichever profile was on screen, so pressing Refresh on the Default profile asked for an alternate key many readers do not have, returned the built-in list unchanged, and reported "for the alternate profile" beside a Default control. Both refreshes still write one shared list of discovered models, and neither changes a stored model.
- **Explanation language is a list rather than a typed code.** It opens with Same as source, which writes the note in the language of the selected text, then Bilingual (English and Korean), then the twenty languages Read Aloud already offers. A code stored before the list existed is kept and shown at the end.
- Eight settings descriptions were shortened at the owner's request, including the Copy result to clipboard label, the welcome line, the Grammar Check introduction, the Input language and Smart Grammar Check descriptions, the Read Aloud Language/Region description, and the Edge speech note. The privacy claims in them are unchanged.
- Eleven mutations were run against the new guards, deleting each guarded behaviour and confirming a named test fails. All eleven were caught.

## 1.7.6

- **The panel is updated silently on the clipboard route rather than left alone.** It previously kept whatever it had been showing, so an earlier rewrite sat there looking like the current one, which is what made a working feature look broken. It now renders the current result without being revealed, so it is accurate and your place in the editor is kept.
- The right-click menu and the Command Palette already shared this route, because both run the same two commands. The KREN panel's own Rewrite button runs Both Variants and therefore always uses the panel, which is the intended behaviour rather than an exception.
- The status bar names the operation while the request runs and confirms when the result is on the clipboard.

## 1.7.5

- **The clipboard route now works from the KREN status bar menu, which is where the owner actually runs rewrites.** A rewrite reaches KREN by two independent paths: the Command Palette on an editor selection, and the status bar clipboard menu, which calls the operation directly and never touches the editor path. Every fix from 1.7.0 through 1.7.4 changed the editor path alone, so nothing the owner did changed, while every test passed.
- A test counts the decision's call sites, so an entry point without the route fails by name rather than shipping silently. Reverting the status bar path to its 1.7.4 state fails it.
- Both paths write the diagnostic line to the KREN output channel, so either can be told apart from the other.

## 1.7.4

- **The clipboard route is silent.** No notification to dismiss. The status bar confirms briefly and clears itself, so a rewrite can be pasted with Ctrl+V without leaving whatever you were working in.
- **Every rewrite writes one diagnostic line to the KREN output channel**, naming the operation, the stored setting, which variants came back, whether the clipboard or the panel was used, and how much was copied. Three rounds of this feature were diagnosed by reading source and reasoning about what must be true, and the reasoning was right about the code and wrong about the running product every time.
- **The toggle sits below the OUTPUT group**, where the owner asked for it, and still outside every collapsible group.

## 1.7.3

- **`Copy result to clipboard` now works.** It decided from how many variants the provider returned, which is a proxy for the command that was run rather than the command itself. When the two disagreed the route silently fell through to the panel, so the result appeared in the sidebar and the clipboard was untouched, with no error to explain it. The decision is now keyed on the operation, which is fixed before the request is sent and no provider response can change.
- **The copied text is the variant that was asked for.** Matching by variant identifier rather than taking the first in the list, so a Full Rewrite cannot copy the Minimal text if both are ever returned.
- **The toggle moved to the top of the Rewrite Text settings section**, above every collapsible group. It shipped inside the OUTPUT group, which meant expanding a section to find it.
- If there is nothing to copy the route is abandoned and the panel opens as usual, so an empty clipboard and a silent panel cannot lose the result between them.

## 1.7.2

- **The documentation describes what actually shipped.** The in-panel User Manual still said the header carried a Home control next to the menu, with no mention of the Settings gear added in 1.7.0, and the User Guide did not mention `Copy result to clipboard` at all. Both features were correct and both shipped described as their predecessors.
- Two tests now read the shipped documentation, because neither gap is visible to a test that checks behaviour, which is why both survived a green suite twice.

## 1.7.1

- **`Copy result to clipboard` is now switchable from KREN's own Settings screen**, under Rewrite Text in the OUTPUT group. 1.7.0 declared the setting in the extension manifest, so it existed in VS Code's settings editor and nowhere the owner looks. The behaviour was correct and reachable only by people who already knew it was there.

## 1.7.0

- **A Settings gear sits beside Home in the panel header.** Settings was reachable only through the menu, which is two actions for the screen the owner opens most. The menu entry stays.
- **Rewrite Text can send a single-variant result straight to the clipboard.** Turn on `Copy result to clipboard` and a Minimal Rewrite or a Full Rewrite is copied and announced without the panel changing at all, so the result can be pasted without moving attention to the sidebar. Off by default.
- **Both Variants always uses the panel**, whatever that setting says, because it returns two results to choose between and copying one of them silently would be choosing on the reader's behalf.
- The clipboard route still records the result, so Copy, Replace, and the hover card work on it exactly as before.
- The vendored shared core is rebaselined to 0.14.2, and the superseded 0.14.0 tarball is removed. The public-tree classification names the tarball by version deliberately, so a rebaseline that left both behind would fail the build rather than publish two.

## 1.6.1

- **Read Aloud retries with Auto-detect before reporting a failure.** A Language/Region that does not match the text is the most likely reason Edge synthesis fails, and it is the one KREN can correct without asking. A failed attempt now resolves the locale from the text and speaks once more, and only a second failure is reported. The retry does not rewrite the stored setting, because that choice was made deliberately; KREN says which locale spoke and that the setting is unchanged.
- **The failure message names the locale it tried.** It read "KREN could not generate or play the selected Edge online voice. Check the Python command, edge-tts installation, voice ID, and network connection," which sent the reader to four things that were usually all fine. Two messages replace it: one naming both locales after a retry, which says the cause is not Language/Region, and one naming the locale and the voice when Auto-detect was already in force.
- **German is detected from conversational text.** Core 0.14.2 is now vendored. The detection word lists were built from formal prose and carried none of the function words a greeting uses, so "Wie geht es dir? Lange nicht gesehen." matched a single German word and resolved to English. German, French, and Spanish lists gained their common conversational words. Korean was unaffected, because it is detected by script rather than by word list.

## 1.6.0

- **The AI English Tutor's Generate control is now on screen when the page opens.** It sat inside the closed `REVIEW RECIPE` section, so the page presented a learning map and no visible action. A persistent region under the page heading now carries `Generate lesson`, and `Regenerate lesson` and `Generate exercises` once a lesson exists, with `Cancel` while a request runs. When no Primary target is chosen it says so in readable text rather than only in a tooltip.
- **Pin is removed, and so is the accordion it worked around.** Tutor sections open and close independently, so keeping the map open while adjusting other controls needs no separate control. A saved state with several sections open is now simply valid.
- **The learning map shows only what you selected.** An unselected row carries no indicator, where `O` for Off was previously drawn on around 120 of the 123 rows. A selected row reads `Primary` or `Support` as a word rather than a letter, and a collapsed branch reports how many selections are inside it instead of showing `M`.
- **Selecting a target is one click.** The first leaf you choose becomes Primary and later ones become Support. A selected Support carries `Make Primary`, which promotes it and demotes the previous Primary in one step. Choosing Supports before a Primary is allowed, so three Supports and no Primary still leaves the next leaf available.
- **A lesson says when it is stale.** Changing a target or a lesson setting used to leave the displayed lesson unmarked while quietly splitting the two regeneration paths: regenerating one example used the recipe the lesson was built from, and generating exercises used the current settings. The lesson is now marked as generated from earlier settings, and the interface says which recipe each path uses.
- **Fixes a way to lose targets you had chosen.** Promoting a Support to Primary could discard the other Supports. Found by deleting the behaviour and watching all 496 tests still pass, because the existing test promoted the only Support in the selection and so never reached the code it guarded.
- Rows are focusable controls carrying `aria-disabled` and a named reason rather than native disabled buttons, branches carry tree semantics with their expanded state, and focus returns to the row you acted on after the page redraws.
- `Clear all` is now `Clear targets`, which is what it clears.

## 1.5.1

- **All six LLM ROUTING groups now offer what Rewrite Text offers.** Translation, Grammar Check, Explain Meaning or Nuance, User Dictionary, and AI English Tutor showed three controls where Rewrite Text showed seven. Every group now carries Provider, Gemini profile, Model with its Refresh control, Thinking level, Automatic fallback, Fallback model, and Fallback model thinking level, rendered by one helper.
- **Grammar Check's routing is editable, and it edits the same profile User Dictionary does.** Changing the model in either group changes both, because there is one stored profile drawn in two places rather than two settings kept in step. The read-only mirror controls are gone.
- **Changing a Read Aloud control no longer jumps the panel to Rewrite Text.** Opening Settings through the gear beside a rewrite result asks for the Rewrite Text section, which is wanted; the same action starts a background voice refresh, and that refresh re-rendered with the request still pending, so the panel scrolled back after you had moved to Read Aloud. The refresh no longer renders while a section request is outstanding.
- Only Google Gemini provides a translation route, so Translation still lists OpenAI and Anthropic unselectable and says why. Every other control in that group is now available.
- The two AI English Tutor design documents are classified for the public tree. They were copied in so a delegated run could read them and committed unclassified, which the fail-closed builder correctly refused once they became tracked.


## 1.5.0

- **AI English Tutor, reachable from the hamburger menu and from `KREN: Open AI English Tutor`.** One scrolling page of foldable sections: the learning map, the lesson settings, the five Rewrite axis groups, its own LLM ROUTING group, and the review recipe, with the generated lesson between the controls and the exercises.
- **The map is 123 curated nodes across five hubs,** carried in `@kren/core` as versioned data rather than written into the panel. Selection allows one Primary and up to three Support targets, and the limits, the compatibility check, and the lesson validation all live in Core so Office will get the same answers.
- **The lesson is something to act on, not only to read.** Every example plays, copies, looks a word up, translates, and regenerates on its own. Regenerating one example asks for one example and leaves the other five byte-identical.
- **A request in flight blocks only the item it concerns.** The page-wide busy notice is not used here, so a learner can read, scroll, and play the rest of the lesson while one example is being replaced.
- **Exercises and a requested review.** Generate up to twenty written exercises from the same recipe, answer one, and ask for a review that marks the exact spans of your own answer: what is correct and why, what is wrong and the correction. Refresh replaces the set rather than appending, so the count on screen is honest.
- **A review that names no span of your answer is refused rather than shown.** "Good job" is what a model returns when an answer is broadly fine, and it teaches nothing, so Core validates that every quoted span occurs verbatim in what you wrote.
- **Nothing is sent that you did not ask to send.** No editor selection, document text, file name, workspace path, User Dictionary entry, or earlier lesson reaches any tutor request. A review carries your answer, the exercise, and the active targets, and nothing else. Tests assert the exact serialized keys rather than a list of things that should be absent.
- **Nothing generates on its own.** Opening the page, expanding a section, selecting a target, editing a setting, typing an answer, and scrolling issue no request at all.
- Tutor settings are held for the session and written nowhere. Changing a tutor axis leaves the matching Rewrite Text setting alone, and the reverse.
- The tutor has its own provider, model, and thinking or effort, defaulting to Gemini, `gemini-3.6-flash`, and medium. A lesson is a longer generation than a sentence rewrite and deserves its own answer.


## 1.4.2

- **All five features that call a language model now present the same LLM ROUTING group.** Rewrite Text had a foldable, Explain and User Dictionary had a flat list, and Translation and Grammar Check showed nothing at all, so where a request goes was answered four different ways and twice not at all. One helper renders all five.
- **Translation owns its provider, model, and thinking or effort.** It read the Rewrite Text model before, which meant changing the Rewrite model silently changed what Translation called. A reader on defaults sees no change; a reader who had customised `kren.gemini.model` will find Translation back on `gemini-3.6-flash` until they set `kren.translation.model`.
- Only Google Gemini provides a translation route. OpenAI and Anthropic supply Explain and Rewrite only, so Translation lists them unselectable and says why, rather than accepting the choice and failing at the request.
- **Smart Grammar Check keeps following the User Dictionary profile, and now shows it.** The two are one language-model configuration; a second copy would let a reader set two models and never learn which one ran. Grammar Check's group displays that profile read-only and points at where to change it.
- **The two Gemini preset toggles are gone.** Each set a provider that the select directly below it already set, and each carried its own copy of the regional eligibility sentence. That sentence is now stated once, under Credentials and Usage: a Google AI Studio key is not available in every country.
- A group that cannot act says so where it stands. Translation's group is dimmed under Google Cloud Translation and Grammar Check's is dimmed while Smart Grammar Check is off, both following the setting as you change it rather than waiting for the next render.
- The provider list and the six thinking or effort levels are defined once and read by Translation, User Dictionary, the manifest, and the panel validator. A test compares all four.

## 1.4.1

- **Auto-detect now tells Latin-script languages apart.** German was read in English, because the previous answer stopped at the script and fell back. The script cannot separate German from English; the words can, so detection now reads closed-class words and characters no other candidate uses. It answers only on clear evidence: one accidental hit, or two languages scoring alike, still falls back.
- **Microsoft Edge Online is the default speech source, and "(experimental)" is gone.** It reads twenty languages where Local Windows reads whichever voices the machine happens to have installed.
- **Under Auto-detect the voice identifier is no longer editable and no longer shows a stale value.** It reads "Auto-selected by KREN", because the locale is decided per playback and the voice follows it.
- **Choosing a Language/Region now moves the voice with it.** Selecting Korean used to leave the voice list on "Custom voice ID" showing whichever English voice was last stored. The two controls describe one choice, so one moving moves the other.
- "Voice" is now "Edge TTS Voice", and Rewrite Text's ROUTING group is now "LLM ROUTING".
- Settings panel headings are consistently title-cased: "Startup and Panel", "Credentials and Usage", and twelve more.

## 1.4.0

- **Read Aloud speaks twenty languages through Microsoft Edge Online,** the same twenty Rewrite Text writes in. Two controls: **Language/Region** picks the language, **Voice** lists only the voices Microsoft offers for it. The Voice control stays visible but inert under Auto-detect.
- **Auto-detect resolves in three steps.** The language a KREN result already records, which is not a guess at all; then the script of the text, which is deterministic for Hangul, kana, Thai, Arabic, Devanagari, and Han; then your Language/Region preference. KREN does not guess between French, Spanish, German, Italian, and Portuguese, because they share an alphabet and a wrong guess reads your text in the wrong accent.
- A voice belonging to another language is never carried across when you change language. Selecting Korean after using an English voice now speaks Korean.
- **The old voice preset list offered `en-US-ChristopherMultilingualNeural`, which Microsoft does not have and has not had.** Selecting it produced a synthesis failure with no explanation. The list is now generated from the runtime's own catalog, and a test proves every default is a voice its locale actually lists.
- No `Multilingual` voice is a default, because Microsoft publishes no machine-readable statement of what languages they cover. They remain selectable.
- The Editable Edge voice ID field stays authoritative and still accepts any identifier, including one KREN does not list.

## 1.3.16

- **Fixes "KREN rejected an invalid value for rewrite.otherOutputLanguage",** which refused every language on the Other output language list. The panel validator handles rewrite axes generically, and this setting is not an axis, so it fell through to a fallback that accepts only booleans.
- **Closes the defect class rather than the instance.** The same shape shipped in 1.3.13, where Grammar Check refused Auto-detect. The validator lived in a module that imports vscode and so could never be tested; it is now its own module, and a test walks every setting the panel is allowed to write and proves the validator accepts a legal value for each. Adding a key without a validator branch now fails the suite.

## 1.3.15

- **Grammar Check refuses text that contradicts its Input language.** Selecting American English and running the check on a Korean sentence produced nothing from Harper, which has no Korean rules, and a happy correction from Smart Grammar Check, so neither half did what the setting promised and nothing said so. It now stops before any provider call and names Auto-detect as the fix.
- **Rewrite Text gains "Other languages"** and a second control beside it offering Arabic, Chinese (Hong Kong, Simplified, and Traditional), French, German, Hindi, Italian, Japanese, Korean, Portuguese (Brazilian and European), Spanish, Thai, and Vietnamese. The second control stays visible but inert until Other languages is selected, and the group summary names the chosen language rather than the word "Other".
- **The panel header no longer drops its buttons to a second line while the row is mostly empty.** It was forced into a column below 520 pixels, a width the secondary sidebar sits at all the time; it now wraps only when the controls genuinely do not fit.

## 1.3.14

- **Rewrite Text can now actually write in the output language you chose.** The axis existed and was inert: the language rule said "never translate it" and the variety instruction was gated on the text already being English, so selecting American English on Korean text returned Korean. Choosing an English output language now translates the source into English; **Same as source** keeps it as written. The result still reports the language it detected in your text.
- **Follow Grammar Check is removed from Output language.** It named another setting rather than a language, so changing Grammar Check silently changed what Rewrite Text produced, and it had no answer at all once Grammar Check gained Auto-detect. Same as source is the new default, and a stored Follow Grammar Check migrates to it.
- **Grammar Check Auto-detect is selectable.** The panel validator carried a fourth hand-written copy of the dialect list, so choosing Auto-detect produced "KREN rejected an invalid value for grammar.dialect" and snapped back to American English. The setting, the manifest, the panel select, and the validator now read one shared list, and a test compares all four.
- The Start page opens with "KREN is a privacy-conscious language copilot".

## 1.3.13

- **Harper's findings are now sent to Smart Grammar Check as reference, and the model makes the final call.** Harper reads one span and ranks spelling candidates by similarity, so "moringn" produced *miring*, *mooing*, and *mooring*; the model read the sentence and answered *morning*, and that answer was being computed and discarded, because the old merge rule dropped every model finding that touched a Harper one. The model now receives the flags and candidates with the passage, and its correction becomes the selected one. Harper's candidates stay listed below it, along with Add to local dictionary.
- **Grammar Check gains an Input language setting with Auto-detect, on by default.** Harper carries English rules and an English dictionary, so on French it reported every word as a misspelling. Auto-detect runs it on English and skips it on anything else, leaving the passage to Smart Grammar Check. Naming a dialect forces Harper to run, so a wrong guess can be overruled. Grammar Check no longer refuses non-Latin text outright.
- **Rewrite Text: "English dialect or variety" is now "Output language", with a new Same as source option** that keeps the result in whatever language you wrote. Follow Grammar Check falls back to it when the input language is Auto-detect or not English.
- The neutral rewrite preset is now called **Plain Native** rather than Plain English. It never imposed English and does not now; it applies neutral written prose in whatever language the source is in.
- User Dictionary meanings set the number, part of speech, and definition on one line, the way a printed dictionary does, instead of spending a line break on the number.
- Add to local dictionary is separated from the options above it, so it no longer reads as a fourth choice.
- The duplicate Back to result button above KREN Settings is gone; the header control added in 1.3.12 covers it.

## 1.3.12

- The Start page action buttons take **one column while they sit beside the numbered steps**, because two of them in that narrow column truncated every label to "English ...". They take two columns once the layout stacks and the grid has the panel's full width, and one again below 380 pixels.
- **Smart Grammar Check corrects a misspelling to the word the sentence needs**, not to whichever real word is nearest in spelling. "She go to the school without breakfast this moringn." returned "miring", a real word that leaves the sentence meaningless; the instruction now says to read the sentence first, and carries that input as a worked example.
- A new **Back to result** control sits between the eraser and Home on every screen while a result is held. The panel keeps a result until you clear it or run something new, and until now the only way back from Settings or the Start page was to run the operation again.
- **A word with no surrounding text produces no captured-text box.** Repeating the word above the word is not context.
- The box is headed **In the captured text** rather than "In the captured sentence", because the capture stops at a line break and a heading or a list item is not a sentence.
- Captured text is tidied before it is stored: leading bullets, dashes, and list numbers are dropped, as are trailing commas, colons, and semicolons, and a run that reads as a complete sentence but lost its full stop to a line break gets one.
- Captured text and generated examples are now set at the same size as the meaning they illustrate, in italic, with no fill and no indent, left-aligned with the definition above them. The muted notes below the settings lost their filled background for the same reason.

## 1.3.11

- User Dictionary gains **Smart Word Capture**, on by default. Capture sends the single sentence your selection sits in, and the saved entry leads with the meaning that sentence uses under the heading **In the captured sentence**, followed by the sentence itself, with the complete list under **All meanings** below. Selecting *turn up* in "He turned up to the party without invitation" records *to arrive or appear*; the same words in "The volume of the speaker turned up to its max" record *to increase*. When the sentence does not distinguish the meanings, the entry says so rather than guessing.
- The sentence is stored with the entry, survives a JSON or Markdown export, and is named in the entry's Source line, because it changes what left the machine. Nothing else from the document is sent: not the paragraph, not the neighbouring sentences, not the file name or workspace path. A sentence over 500 characters is dropped rather than clipped. Turn `kren.userDictionary.smartWordCapture` off to send the expression alone.
- Captured sentences and generated examples are set smaller than the meaning they illustrate.

## 1.3.10

- **A meaning can carry its own pronunciation, for heteronyms.** One entry-level pronunciation is wrong for exactly the words you record because the spelling misled you: the noun and the verb *record* do not sound alike, and neither do *lead* the metal and *lead* the verb. KREN asks for it only where the sound actually changes, and you can set or correct it by hand in the entry editor.
- A meaning shows its part of speech only when the meanings of that entry disagree about it. Three meanings all reading "adjective", under a filing line that already says adjective, was one fact written three times.
- **Ignore this finding** is gone from the grammar panel. **Keep original** is the per-finding answer there. A persistent ignore is still in the editor's Quick Fix menu, which is where it belongs, because it stores something and Keep original does not.
- A clean grammar result shows only the sentence saying so, with no **Copy checked text** and no **Open full details**.
- **Add to User Dictionary** joins the Start page grid between Rewrite and Read Aloud.
- The Start page grid is sized the way the Office task pane sizes its actions: two columns collapsing to one, a uniform button height, and a label that clips rather than wraps. It was one column at full width and two only when narrow.
- The Start page description says smart grammar checking, which is what ships enabled.

## 1.3.9

Fixes found by reviewing 1.3.8, most of them defects that predate it.

- **Add to local dictionary and Ignore this finding in the panel did nothing, for every finding.** The buttons carried the finding identifier in one attribute and the code that sends the message read every other attribute except that one, so the message was rejected and dropped in silence.
- **Smart Grammar and spacing underlines offered no Quick Fix actions at all.** The editor's action provider recognised only the local checker's identifier format, so right-clicking one of those underlines produced no correction, no More details, no dictionary entry, and no ignore. All three modules that recognise a finding identifier now share one rule.
- Editing the corrected text and then changing a correction rebuilds the box. KREN now asks before discarding your edits instead of losing them silently.
- The corrected-text box is capped at the length the extension will accept. It was uncapped while the extension rejected anything longer, so Replace and Copy silently did nothing past that point, and Copy still reported success.
- Two overlapping actions no longer uncover the panel while one is still running. The wait notice was a single string, so whichever action finished first lifted the cover for both.
- Read Aloud no longer covers the panel. Its command does not return until the speech ends, so the cover would have sat on top of the panel's own Stop control for the whole reading.
- A new result no longer opens scrolled to wherever the previous one was left.
- The manual and user guide no longer overstate what the wait cover does.

## 1.3.8

- **Fixes Apply and Copy on a grammar result, which did nothing at all.** The panel's message validator accepted only the local checker's finding identifiers, so one Smart Grammar or spacing finding in the selection made the whole message invalid, and an invalid message is dropped in silence. Smart Grammar Check is on by default, so this was the common case. Add to local dictionary and Ignore this finding from the panel were broken the same way.
- A grammar result now shows the checked passage with the selected corrections already in it, in an editable box, the way the Word task pane does. Choosing a correction changes what the box holds; you can also edit it by hand. **Replace** and **Copy** are icon controls that act on exactly what the box holds, and **Reset** returns it to the selected corrections. Overlapping corrections are reported rather than silently resolved.
- Grammar Check no longer raises a notification for findings. The editor underlines and the panel were already showing them. A clean result is still announced, because nothing else on screen changes when a check finds nothing.
- The grammar result header names the Smart Grammar model beside **Harper (offline)** when both ran.
- The panel covers itself and names what it is waiting for while an action runs, and accepts no input until it finishes.
- A **Home** control sits beside the hamburger menu on every screen.
- The gear on a rewrite variant opens the **Rewrite Text** settings group and scrolls to it, and the **Regenerate** control now sits at the top of that group rather than at the top of the page. Regenerating shows the wait notice.
- Every rewrite settings group states its settings and their current values on its collapsed summary line. It previously listed only settings that were off their default and printed "Defaults" otherwise, which said nothing about what the group controlled.
- Sections you fold on the Settings screen stay folded, and your place on the page is kept, when a setting change redraws the panel. Changing one setting used to reopen every folded section and jump to the top.
- Adds space between the last credential row and the **Delete all API keys** and **All KREN settings** controls.

## 1.3.7

- Rewrite results carry icon controls: **Copy**, guarded **Replace**, **Read aloud** and **Stop** when Read Aloud controls are on, and a **gear** that opens the rewrite settings. Point at a control to read what it does.
- Reaching Settings through that gear adds a **Regenerate** control at the top. It stays disabled until a setting actually changes, then produces the same rewrite again with the new settings and returns you to the result.
- Shows **Minimal Rewrite** and **Full Rewrite** together instead of behind tabs, with the axis line under both panels rather than in the card title.
- The nine capability boxes on the Start page are now buttons that run the action they name. A capability with no key is shown disabled with the reason, rather than silently doing nothing.
- User Dictionary entries carry **Read aloud**, **Stop**, **Edit**, and **Delete** directly under the term.
- Every stored User Dictionary entry now shows a **Source** line saying where its wording came from: the provider and model that drafted it, whether you edited it afterwards, and, when the combined capture ran, the Merriam-Webster reference work and whether it matched. It credits a consultation rather than a quotation, because Merriam-Webster wording is never stored in a personal entry.
- Fixes the entry type a generated entry receives. The instruction described the field only as a short label, so the model invented one, and the noun **repository** was filed as **headword**. The vocabulary is now stated and enforced. Entries saved before this keep their stored value until you regenerate or edit them.
- Credential rows use a floppy-disk control to store a key and a waste-basket control to remove one. The delete-all control is now a text button reading **Delete all API keys**.
- Uses the **Grammar Check** label in the clipboard Quick Pick only when Smart Grammar Check is off, and gives Full Rewrite its own icon.

## 1.3.6

- Renames **Hide KREN** to **Close KREN Panel**. VS Code's own Secondary Sidebar tab menu carries an entry reading **Hide 'KREN'**, which unpins the tab and is what makes it vanish when you select another tab. Two commands a word apart doing different things is how the owner lost an afternoon to a disappearing tab. The command identifier is unchanged, so any keybinding still works.
- Changes the attribution to **Designed & Developed by T.H. YANG using CLAUDE CODE and CODEX**.


## 1.3.5

- Corrects what 1.3.4 claimed. The KREN tab leaving the Secondary Sidebar when you select another tab is VS Code's per-tab **Keep** setting, not anything KREN controls, and 1.3.4's setting description, user guide, and code comments all said otherwise. They now say what is true. The repair is to right-click the KREN tab and choose **Keep 'KREN'** once.
- Renames the startup setting in the settings panel to **Reopen KREN at startup**, which is what it does.

## 1.3.4

- Showing and hiding KREN now survives a restart. Activation used to clear KREN's view unconditionally, so a KREN you had open came back hidden after every restart. **Show KREN Secondary Sidebar** and **Hide KREN** now set `kren.results.openAtStartup`, which is the single record of whether KREN is shown.
- Note for anyone reading this entry as first published: it also claimed to stop the KREN tab disappearing when another tab in the Secondary Sidebar is selected. That claim was wrong and is corrected in 1.3.5.

## 1.3.3

- **Hide KREN** now hides only KREN. It previously closed the entire Secondary Sidebar, taking Chat, Claude Code, Codex, and anything else living there with it; reopening the sidebar from one of those brought KREN straight back, because it had never actually been hidden. KREN now removes its own view and leaves the workbench layout alone.
- Renames the command from `kren.hideSecondarySidebar` to `kren.hideResults`, titled **Hide KREN**, because the old name described what it wrongly did. A custom keybinding on the old identifier needs updating; KREN ships no default keybinding for it.

## 1.3.2

- Copying a result no longer raises a notification. The button you pressed reads `Result copied` for a moment instead, so the confirmation appears where you are looking and nothing is left on screen to dismiss.
- Bounds User Dictionary import at 5,000 entries, configurable, and refuses a larger file with the count rather than accepting it slowly.
- Updates development dependencies to clear all six security advisories. No dependency that ships to users changed.

## 1.3.1

- Fixes an open notification freezing the KREN panel. Copying a result showed "KREN result copied." and, until that notification was dismissed, every button in the secondary sidebar was accepted but never ran. KREN no longer waits for a notification to be dismissed before continuing, so the panel stays responsive whether you close it or leave it. Present since 1.1.0.

## 1.3.0

Merriam-Webster's terms allow no more than two reference works per account, and the registration page issues at most two keys, so KREN stores at most two. All three reference works stay available and each user configures whichever two they hold keys for; the unconfigured one remains visible with the reason rather than being hidden.

- Completes the User Dictionary. Entries can be searched across term, aliases, meanings, tags, and collections, and filtered by language, collection, entry type, capture mode, and whether a Merriam-Webster reference is attached.
- Adds purge, which always previews before it confirms and then deletes exactly the entries the preview listed rather than recalculating ages at confirm time. Removing everything requires typing the confirmation, which no age-based option can reach.
- Adds import and export in JSON and Markdown. JSON round-trips losslessly and is the backup format; Markdown is human-readable and lossy by design, and the interface says so. Import previews entry count, duplicates, and invalid records, and never overwrites without an explicit decision. The file being imported is never modified.
- Discloses the exact storage path in Settings, with recovery guidance for a corrupt store. A storage error now renders as a storage error and never as an empty dictionary.
- Adds the Merriam-Webster capture mode, which runs a live lookup and a language-model generation as two independent operations, shown separately and attributed. The dictionary text never enters the model prompt and the model output never enters the dictionary request.
- Replaces the four rewrite presets with thirteen: Plain English, Manuscript, Grant Proposal, Instruction, Technical document, Legal document, Regulatory document, Professional email, Casual email, Professional presentation, Research presentation, Teaching presentation, and Investor presentation.
- Reduces the speech controls to a speaker icon and a filled square, and adds read-aloud to User Dictionary entry details using the existing speech settings.
- Folds every settings group to a summary line and moves User Dictionary next to Dictionary.
- Warns that an expression is already in the User Dictionary before spending a provider call on it, and drops the redundant language code from the entry list.
- Fixes the Merriam-Webster credential panel comparing against its own copy of the key limit instead of the shared constant, which let the panel refuse a key while announcing a different limit.
- Stops the Voice axis from governing formality. Voice `Preserve` previously asked to preserve the writer's formality as well, which contradicted the Formality axis whenever it was set to anything other than Preserve. Plain English, Professional email, and Casual email each sent both instructions. Formality is now governed only by the Formality axis.
- Renames the rhetorical-mode default from `Preserve Original` to `Preserve`, matching the five other axes whose leave-it-alone value is named that. An existing stored `preserveOriginal` migrates automatically at every configuration scope.

## 1.2.0

Private only. Public KREN remains at 1.1.0, which is why this is 1.2.0 rather than another 1.1.0: two channels must never carry the same version number with different contents.

- Replaces the four flat rewrite style settings with ten axes: modality, function, English variety, domain, formality, voice, stance, length, perspective, and rhetorical mode. Every axis that can preserve the original leads with `preserve`, so a fresh install is unchanged.
- Removes `kren.rewrite.tone` and migrates all ten of its values onto the new axes. Migration runs once and is idempotent.
- Adds four rewrite modes, Manuscript, Upward email, Presentation, and Plain English, and groups the settings panel so each group collapses to a summary line. A mode is a named point in axis space and stores nothing, so the label is computed and reverts to Custom when any axis changes.
- Adds the User Dictionary in its LLM Only capture mode, off by default. Select an expression, review an editable draft, and save it. Entries are stored locally in VS Code global storage and can be listed, edited, and deleted. Only the selected expression and KREN's bounded instruction are sent to the provider.

## 1.1.0

- Adds the Merriam-Webster Medical Dictionary alongside the Collegiate Dictionary and Collegiate Thesaurus. Merriam-Webster issues two API keys per account, so KREN offers all three reference works and each user configures any two. Adding a third key is refused at entry, and the unconfigured reference work stays visible with the reason rather than being hidden.
- Reports a settings-panel action that could not be completed. A command that is unavailable or that fails now names itself instead of leaving a button that appears to do nothing. Provider error text is passed through with credentials redacted.
- Hardens the Cloud Translation usage ledger with stale-lock recovery and fail-closed corruption handling.
- Keeps read-aloud stop and audio acknowledgements responsive while provider model discovery runs in the background.
- Bounds Harper worker shutdown, removes its working-directory executable fallback, validates translated HTML entities, and clears pending grammar timers on deactivation.

## 1.0.4

- Adds an explicit, global `Open KREN Sidebar at startup` option for controlled
  startup testing. It is off by default.
- Keeps startup sidebar rendering free of eager grammar-worker warm-up, Windows
  voice discovery, and hidden-webview retention.

## 1.0.3

- Restores the KREN status-bar entry when VS Code starts.
- Keeps the hardened results view gated until an explicit KREN action and does
  not retain the webview while hidden.
- Defers Windows voice discovery until the user opens KREN settings.

## 1.0.2

- Adds automatic source-language detection to Rewrite Text and keeps the result in the detected language.
- Adds a manual source-language override and applies English-variety preferences only when the source language is English.
- Removes automatic startup activation and eager grammar-worker warm-up.
- Keeps the KREN results webview unavailable until an explicit KREN action reveals it.
- Stops retaining hidden webview content and disposes view-scoped listeners and audio waiters.

## 1.0.1

- Replaces the retired alternate-profile fallback preset with stable `gemini-3.5-flash` and migrates the former saved default automatically.
- Adds an independent fallback thinking level and applies the same-provider fallback to both Rewrite Text and Explain Meaning or Nuance.
- Keeps KREN commands responsive while ordinary provider-error notifications remain visible.

## 1.0.0

- Based on the final public KREN 1.0.0 source and kept under the separate `local.kren-translate` extension identity.
- Provides English, Medical, and Korean dictionaries, sense-grouped synonyms, offline English grammar checking, multilingual translation, meaning and nuance explanation, multilingual rewriting, pronunciation, and read-aloud workflows.
- Uses explicitly selected or copied text only, stores API keys in VS Code Secret Storage, collects no telemetry, and keeps grammar checking offline.
- Adds private-local Merriam-Webster Medical Dictionary lookup with a separately stored user-owned key; no shared keys are included.
- Adds guarded editor replacement, provider-specific settings, retry controls, Cloud Translation usage protection, Workspace Trust protection for Edge Online speech, complete attribution, and public security and privacy documentation.
