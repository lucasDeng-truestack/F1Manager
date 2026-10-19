import type { Command } from '../sim/types';

/** A line pool. The tuple type makes "at least 3 variants" a compile-time rule. */
export type Pool = readonly [string, string, string, ...string[]];

/** Situation keys per command. Every command must include `default`. */
export interface Situations {
  BOX:
    | 'box_cancel' | 'box_puncture' | 'box_final_lap' | 'box_rain_slicks' | 'box_dry_inters'
    | 'box_under_sc' | 'late_dead_tyres' | 'pointless_stop' | 'default';
  PUSH: 'push_under_sc' | 'push_on_dead_tyres' | 'push_final_lap' | 'push_already' | 'default';
  SAVE_TYRES: 'save_final_lap' | 'save_fresh_tyres' | 'save_already' | 'default';
  DEFEND: 'defend_under_sc' | 'defend_nobody' | 'defend_already' | 'default';
  PLAN_B: 'to_plan_b' | 'to_plan_a' | 'default';
  COPY: 'default';
}

/** Compile-time guard: every Command has a Situations entry, and each entry includes `default`. */
type AssertDefaults = { [C in Command]: 'default' extends Situations[C] ? true : never };
export const situationsHaveDefaults: AssertDefaults = {
  BOX: true, PUSH: true, SAVE_TYRES: true, DEFEND: true, PLAN_B: true, COPY: true,
};

export type ResponseTable = { readonly [C in Command]: { readonly [S in Situations[C]]: Pool } };

export const responses: ResponseTable = {
  BOX: {
    box_cancel: ['Copy, staying out.', 'Staying out, got it.', 'No stop? Make up your mind!', 'Cancel box, understood.'],
    box_puncture: ["Yes! Box, box, I'm on the rim!", 'Copy, bringing it in carefully.', 'Thank god. Coming in.', "Box now, it's flapping everywhere!"],
    box_final_lap: ['Why are we stopping?!', "Box? It's the last lap!", 'Are you serious? Final lap!', 'Stopping now? For what?!'],
    box_rain_slicks: ['Finally! Inters please!', 'Copy, I can barely see out here.', "Yes, box! It's a skating rink!", 'Good call, sliding everywhere.'],
    box_dry_inters: ['Copy, slicks. These inters are melting.', 'Good, these inters are cooked.', "Yes, it's bone dry now. Box."],
    box_under_sc: ['Cheap stop, nice.', 'Copy, boxing under the safety car.', 'Good call, free stop.', 'Box under SC, love it.'],
    late_dead_tyres: ['Oh, about time.', 'Now? These died three laps ago.', 'Wow. Great timing. Really.', 'Finally. Nothing left in these.'],
    pointless_stop: ['Box? These tyres are brand new!', 'Why? The tyres are fine!', "Are you sure? They're fresh.", 'Copy... but I just got these.'],
    default: ['Copy, box this lap.', 'Box, box. Understood.', 'Okay, coming in.', 'Copy. Pit lane next.'],
  },
  PUSH: {
    push_under_sc: ["Push? We're behind the safety car!", "Can't push, SC is out.", 'Push where? Safety car, mate.'],
    push_on_dead_tyres: ["Push on these? They're gone!", 'With what tyres?!', "I'm trying, there's no grip!", 'These tyres are ****ed, mate.'],
    push_final_lap: ["Everything I've got, last lap!", 'Flat out to the flag!', 'Copy, giving it everything!'],
    push_already: ["I'm pushing!", "What do you think I'm doing?", 'Already flat out, mate.'],
    default: ['Copy, pushing now.', 'Understood, full attack.', "Okay, let's go.", 'Copy, quali mode.'],
  },
  SAVE_TYRES: {
    save_final_lap: ['Save them for what?', "Save? It's the last lap!", "Save tyres? We're nearly done!"],
    save_fresh_tyres: ['Save? These are brand new.', "Already? They're fresh!", 'Copy... they feel fine though.'],
    save_already: ["I'm already saving.", "Yes, I'm managing them.", 'Doing that already, mate.'],
    default: ['Copy, managing tyres.', 'Understood, lift and coast.', 'Okay, easing off.', 'Copy, tyre saving.'],
  },
  DEFEND: {
    defend_under_sc: ["Defend? We're under the safety car!", 'Nobody passes under SC, mate.', "Defend from who? It's yellow."],
    defend_nobody: ['Defend from who?', "There's nobody behind me!", 'Mirrors are empty, mate.'],
    defend_already: ['Covering the inside already.', "Yes, I know he's there!", 'Already defending, trust me.'],
    default: ['Copy, covering the inside.', "Understood, he won't get by.", "Okay, door's shut.", 'Copy, defending.'],
  },
  PLAN_B: {
    to_plan_b: ['Plan B, copy. Softs.', 'Okay, switching to softs.', "Plan B. Let's be aggressive."],
    to_plan_a: ['Back to plan A, hards.', 'Copy, plan A. Hards it is.', 'Okay, hards again.'],
    default: ['Copy, plan change.', 'Understood, new plan.', 'Okay, noted.'],
  },
  COPY: {
    default: ['Copy.', 'Copy that.', 'Understood.', 'Roger.'],
  },
};

/** UNKNOWN: the parser could not understand the engineer. */
export const sayAgain: Pool = ['Say again?', "Radio's breaking up, repeat?", "Didn't get that.", 'Sorry, say again?', "You're breaking up!"];
