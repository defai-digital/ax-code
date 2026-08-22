use crate_a::{add, greet, Point};

pub fn run(name: &str) -> String {
    let total = add(1, 2);
    let point = Point::new(1.0, 2.0);
    format!("{} {} {}", greet(name), total, point.x)
}
