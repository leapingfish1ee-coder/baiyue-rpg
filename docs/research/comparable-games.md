# 可比游戏研究

检索日期：2026-08-09。以下内容只记录外部产品的可验证模式及其可能启示，不构成 Baiyue RPG 需求。来源可能随产品更新而变化。

## RuneScape

来源：[Skills](https://runescape.wiki/w/Skill)、[Hit chance](https://runescape.wiki/w/Hit_chance)（RuneScape Wiki，社区编辑）、[OSRS New player guide](https://oldschool.runescape.wiki/w/New_player_guide)（OSRS Wiki，社区编辑）。

可验证模式：不同技能对应不同活动，执行相关行动会获得该技能经验。技能等级进一步成为物品、活动和其他内容的要求。OSRS 指南把 Attack/装备命中、Strength/最大伤害和 Defence/防御加成作为不同维度；RuneScape 的现行 PvM hit chance 又使用 accuracy、目标 armour 和 affinity。不同版本的具体命中语义并不相同。

启示：同一角色通过实际行动成长，并用技能等级解锁内容，适合作为 Baiyue RPG 的基础模型。战斗属性可以分离，但 Baiyue RPG 不照搬其多战斗技能、公式、具体数值或新版 damage-potential 语义。

## Melvor Idle

来源：[Beginners Guide](https://wiki.melvoridle.com/index.php?title=Beginners_Guide)、[V0.17 Mastery System Rework](https://wiki.melvoridle.com/w/V0.17)、[FAQ](https://wiki.melvoridle.com/index.php/FAQ)、[Bank](https://wiki.melvoridle.com/w/Bank)、[Hitpoints](https://wiki.melvoridle.com/index.php?title=Hitpoints)、[Old Temple Chart](https://wiki.melvoridle.com/w/Old_Temple_Chart)（社区主导 Wiki，Beginners Guide 自述 majority community led）。

可验证模式：玩家选择技能动作后，动作持续产出；成功 Skill Action 同时提供 Skill Experience 和对应具体动作的 Mastery Experience。Mastery 只改善对应动作。FAQ 分开描述 Attack 提高 accuracy、Strength 提高 max hit、Defence 提高 evasion，并把 HP 和 Damage Reduction 作为安全放置判断；Bank 是有槽位上限且可以扩充的库存。Hitpoints 页记录默认每 `10s` 恢复最大 HP 的 `1%`。Old Temple Chart 的描述明确说明它会让对应 dig site 位置图标出现在 Cartography 地图上。

启示：全技能成长和行动结算适合首版；动作级 Mastery 只作为后续目标熟练度参考。发现内容产生地图位置可以作为线索表达的参考，但 Baiyue RPG 的关键叙事不采用随机掉落。Baiyue RPG 只有在单一技能至少达到需求规定的内容规模并出现长期目标选择时才评估加入，明确不采用 Melvor 式共享熟练度池，也不复制其多技能战斗成长、数值、完成度或 bank slot 压力。自然恢复量级只作为候选基线参考。

## Outer Wilds

来源：[Computer](https://outerwilds.fandom.com/wiki/Computer)（Official Outer Wilds Wiki，社区编辑）、[New Horizons Ship Log guide](https://nh.outerwildsmods.com/guides/ship-log/)（Outer Wilds 模组工具文档）。

可验证模式：Ship Log 保存玩家已经发现的信息。Rumor Mode 按信息之间的关系展示 entries；entry 内包含 facts，并以连接表达信息来源或关联。未读信息有显式标记。New Horizons 文档还说明 entry 可以使用 authored positions，而不是只能依赖自动布局。

启示：关系视图可以帮助玩家在长时间探索后重建事实关联。Baiyue RPG 只借鉴“事实 + 关系 + 未读状态”的信息组织，不复制具体谜题、动态布局或按发现顺序变化的连接；现行线索簿规范使用固定 authored layout 和项目自己的确定性推论规则。

## IdleOn

来源：[Legends of IdleOn 官方网站](https://www.legendsofidleon.com/)（官方）、[Steam 商店页](https://store.steampowered.com/app/1476970/idleon__the_idle_mmo/)（开发者发布页）、[Items changelog 1.22](https://idleon.wiki/wiki/Changelog/1.22/Items)（社区 Wiki）。

可验证模式：账户管理多个角色；不同角色可按职业和技能分工，并在玩家离开时继续取得 AFK gains。社区物品表区分 Pickaxe、Hatchet 等工具类别，并列出对应 skilling 属性。

启示：工具与生活技能绑定可以作为装备槽和任务工具要求的参考；长期技能专精与资源互补也能形成 MMO 式成长感。但该产品依赖多角色职业分工。Baiyue RPG 已明确选择单角色全技能开放，因此不采用多角色分工、职业锁定或由不同角色并行覆盖全部活动。

## Milky Way Idle

来源：[Skills](https://milkywayidle.wiki.gg/wiki/Skills)、[Equipment](https://milkywayidle.wiki.gg/wiki/Equipment)、[Tools](https://milkywayidle.wiki.gg/wiki/Tools)、[Enhancing](https://milkywayidle.wiki.gg/wiki/Enhancing)、[Loadouts](https://milkywayidle.wiki.gg/wiki/Loadouts)、[Focus Training](https://milkywayidle.wiki.gg/wiki/Focus_Training)、[Combat](https://milkywayidle.wiki.gg/wiki/Combat)、[HP](https://milkywayidle.wiki.gg/wiki/HP)（社区 Wiki）。

可验证模式：gathering action 可无限重复且不消耗材料；processing action 需要材料，耗尽时停止。工具和 skill charm 对应具体技能；装备系统包含多个槽位，物品可以有 enhancement level，loadout 可以保存装备组合。战斗中，武器决定 Primary Training，charm 可决定 Focus Training 的经验分配。Combat 页给出 accuracy 与 evasion 的 `1.4` 次幂比较、独立 attack interval 和命中后的 Armor 层；HP 页记录基础恢复为每 `10s` 最大 HP 的 `1%`。

启示：区分“可永久持续的采集”和“材料不足即停的生产”有助于定义待机原因。技能工具和可更换装备支持可逆软专精；多槽位、enhancement 和 loadout 说明后期可以表达更多构筑，但首版不需要这些实例状态。战斗公式可以作为最小数值模型的参考，但 Baiyue RPG 不复制其七项战斗技能、技能经验分配、群战、穿透、元素、能力或具体装备系统。

## Guild Wars 2

来源：[Dynamic event](https://wiki.guildwars2.com/wiki/Dynamic_event)（官方 Wiki，社区编辑）。

可验证模式：开放世界动态事件由世界交互触发，玩家是否参加不阻止事件发展；事件结果可改变周边状态并引出后续事件。事件会按附近参与者规模调整。

启示：世界事件可以作为独立世界状态推进，而不是塞进玩家任务。但多人 scaling、事件链和世界持久化都不是当前已确认需求。

## EVE Online

来源：[Scanning](https://support.eveonline.com/hc/en-us/articles/203209902-Scanning)、[Buy and Sell Orders](https://support.eveonline.com/hc/en-us/articles/203218932-Buy-and-Sell-Orders)、[Skill Plans and How They Work](https://support.eveonline.com/hc/en-us/articles/4406388028178-Skill-Plans-and-How-They-Work)、[Skill Training](https://support.eveonline.com/hc/en-us/articles/203217062)（官方支持）。

可验证模式：探索信息分层呈现；市场使用 buy/sell orders 和明确撮合规则。Skill Plan 是带目标和 milestone 的有序技能列表；实际 Skill Training 按现实时间推进，并可在离线时继续 queue。

启示：Skill Plan 的目标和 milestone 表达方式可以在首版之后评估，但现实时间被动训练不适合 Baiyue RPG 的“有效玩法结算”原则。探索和市场启示不变：首期不设计扫描工具/品质，也不设计网络或市场接口。

## 综合判断

已确认的项目结论见[技能成长需求](../requirements/skill-progression.md)：采用单角色全技能开放、有效结算经验和装备软专精；不采用多角色职业分工或现实时间被动训练。

[战斗数值系统](../requirements/combat-numerics.md)已由项目负责人 Accepted。它综合采用独立命中、伤害、护甲、攻击间隔和持续恢复；竞品事实只是研究依据，不能证明其公式或首轮数值已经通过实现验证与实际试玩。

[物品与装备系统](../requirements/item-equipment.md)和[碎片叙事与线索簿](../requirements/narrative-cluebook.md)也已由项目负责人 Accepted。竞品只支持“工具可以形成可逆专精”和“已知事实可以关系化展示”这两类方向判断；具体槽位、库存、掉落、谜题线和触发器来自本项目的产品决策，不是竞品事实的必然结论。

竞品只提供模式证据。多角色并行、action queue、wave combat、动态事件 scaling、probe scanning、order-book market、具体 Mastery 和训练比例都不能因外部产品存在而成为本项目默认设计。
